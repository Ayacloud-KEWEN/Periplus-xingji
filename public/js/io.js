// 数据导入导出：备份 zip（与旧版 MapWeb 导出格式兼容）、从照片批量导入
import { api } from './api.js';
import { map, fitOptions } from './map.js';
import { addPoints, watchPlaces } from './pins.js';
import { t } from './i18n.js';
import { toast, toastError, loadScript } from './ui.js';
import { readPhotoMeta, preparePhoto } from './photos.js';
import { reloadTracks } from './tracks.js';
import { reloadTripOverrides } from './trips.js';

const JSZIP = 'vendor/libs/jszip.min.js';
const BATCH_SIZE = 500;
const MIME_TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', heic: 'image/heic' };

function showOnMap(points) {
    if (points.length === 1) map.flyTo([points[0].lat, points[0].lng], 15);
    else if (points.length > 1) map.fitBounds(points.map(p => [p.lat, p.lng]), fitOptions(15));
}

// ---------- 从照片导入 ----------

export async function importPhotos(files) {
    const list = [...files];
    if (!list.length) return;
    const status = toast('', { duration: 0 });
    const created = [];

    for (const [index, file] of list.entries()) {
        status.update(t('processingPhoto', { current: index + 1, total: list.length, name: file.name }));
        try {
            const meta = await readPhotoMeta(file);
            if (meta.lat === null) {
                toast(t('noGpsInfo', { name: file.name }), { type: 'error', duration: 4000 });
                continue;
            }
            let point = await api.createPoint({
                lat: meta.lat,
                lng: meta.lng,
                title: file.name.replace(/\.[^.]+$/, ''),
                emoji: '📷',
                visited_at: meta.date?.toISOString()
            });
            try {
                const { blob, name } = await preparePhoto(file);
                point = await api.addPhoto(point.id, blob, name);
            } catch (err) {
                toastError(`${file.name}: `, err); // 标注已创建，只是没有照片
            }
            created.push(point);
        } catch (err) {
            toastError(`${file.name}: `, err);
        }
    }

    status.close();
    if (created.length) {
        addPoints(created);
        showOnMap(created);
        watchPlaces(created.map(point => point.id));
        toast(t('photosImported', { count: created.length }));
    }
}

// ---------- 导出 ----------

// 由服务端打包：zip 边生成边下载，照片再多也不会因为浏览器内存不足而失败
export function exportBackup() {
    location.href = '/api/backup';
}

// ---------- 导入 ----------

function pickRegion({ countryCode, state, city, county, town }) {
    return { countryCode, state, city, county, town };
}

function toPointInput(entry) {
    const date = new Date(entry.date);
    return {
        lat: Number(entry.latitude),
        lng: Number(entry.longitude),
        title: String(entry.locationName ?? '').slice(0, 200) || t('newPinTitle'),
        description: String(entry.notes ?? '').slice(0, 5000),
        emoji: String(entry.emojiCategory || '📍').slice(0, 16),
        visited_at: Number.isNaN(date.getTime()) ? undefined : date.toISOString(),
        place: entry.region?.countryCode ? pickRegion(entry.region) : undefined,
        // 备份里带 regionAuto 的是自动识别出来的，不算手动修改
        place_manual: entry.regionAuto ? false : undefined
    };
}

// 判断是否为同一个标注：标题相同，坐标精确到约 1 米
function pointKey(lat, lng, title) {
    return `${Number(lat).toFixed(5)},${Number(lng).toFixed(5)},${title}`;
}

// 按统一的 "/" 路径建立索引：Windows 自带的压缩工具会把路径写成 img\xxx.jpg
function indexZip(zip) {
    const files = new Map();
    for (const entry of Object.values(zip.files)) {
        if (!entry.dir) files.set(entry.name.replace(/\\/g, '/'), entry);
    }
    return files;
}

// zip 里可能多包了一层文件夹，找不到完全一致的路径时按结尾匹配
function findZipFile(files, path) {
    const normalized = path.replace(/\\/g, '/').replace(/^\.?\//, '');
    if (files.has(normalized)) return files.get(normalized);
    for (const [name, entry] of files) {
        if (name.endsWith('/' + normalized)) return entry;
    }
    return null;
}

async function readEntries(file) {
    if (!/\.zip$/i.test(file.name)) return { entries: JSON.parse(await file.text()), zip: null };
    await loadScript(JSZIP);
    const zip = await window.JSZip.loadAsync(file);
    const jsonFile = zip.file(/(^|\/)MapWeb_Export\.json$/)[0] || zip.file(/\.json$/i)[0];
    if (!jsonFile) throw new Error('zip 中没有找到 JSON 文件');
    return { entries: JSON.parse(await jsonFile.async('string')), zip };
}

// 备份里的运动轨迹（MapWeb_Tracks.json）；旧版本的备份没有这个文件
async function importTracksFromZip(zip, status) {
    const file = zip.file(/(^|\/)MapWeb_Tracks\.json$/)[0];
    if (!file) return { added: 0, skipped: 0 };
    let tracks;
    try {
        tracks = JSON.parse(await file.async('string'));
    } catch {
        console.warn('备份里的轨迹文件读不出来，已跳过');
        return { added: 0, skipped: 0 };
    }
    let added = 0;
    let skipped = 0;
    for (const [index, track] of (Array.isArray(tracks) ? tracks : []).entries()) {
        status.update(t('importingTrack', { current: index + 1, total: tracks.length, name: track.name || '' }));
        try {
            const result = await api.createTrack(track);
            if (result.duplicate) skipped++;
            else added++;
        } catch (err) {
            console.warn('轨迹导入失败:', track.name, err);
        }
    }
    if (added) await reloadTracks();
    return { added, skipped };
}

// 旅程的手动调整：备份里按"第几条标注"记录，换成这次导入对应的标注 id，再和现有的调整合并。
// 旧备份直接存的是原数据库的标注 id，换了库就会挂到不相干的标注上，只能跳过
async function importTripOverrides(saved, idOfEntry) {
    if (saved.anchor !== 'entryIndex') {
        console.warn('备份里的旅程调整是旧格式（按原数据库的标注 id 记录），已跳过');
        return;
    }
    const ids = (list) => (Array.isArray(list) ? list.map(idOfEntry).filter(id => id !== undefined) : []);
    const current = await api.getSettings('trips');
    const breaks = new Set(Array.isArray(current.breaks) ? current.breaks : []);
    const joins = new Set(Array.isArray(current.joins) ? current.joins : []);
    // 现有的调整优先：重新导入旧备份时，不能把之后做过的拆分、合并、改名覆盖掉
    const currentBreaks = new Set(breaks);
    for (const id of ids(saved.breaks)) if (!joins.has(id)) breaks.add(id);
    for (const id of ids(saved.joins)) if (!currentBreaks.has(id)) joins.add(id);
    const names = {};
    for (const [index, name] of Object.entries(saved.names || {})) {
        const id = idOfEntry(Number(index));
        if (id !== undefined && typeof name === 'string') names[id] = name;
    }
    Object.assign(names, current.names && typeof current.names === 'object' ? current.names : {});
    await api.saveSettings('trips', { breaks: [...breaks], joins: [...joins], names });
    await reloadTripOverrides();
}

// 备份里的手动调整（MapWeb_Settings.json）
async function importSettingsFromZip(zip, idOfEntry) {
    const file = zip.file(/(^|\/)MapWeb_Settings\.json$/)[0];
    if (!file) return;
    try {
        const settings = JSON.parse(await file.async('string'));
        for (const [key, value] of Object.entries(settings)) {
            if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
            if (key === 'trips') await importTripOverrides(value, idOfEntry);
            else await api.saveSettings(key, value);
        }
    } catch (err) {
        console.warn('备份里的设置读不出来，已跳过:', err);
    }
}

export async function importBackup(file) {
    const status = toast(t('importing', { current: 0, total: '…' }), { duration: 0 });
    try {
        const { entries, zip } = await readEntries(file);
        if (!Array.isArray(entries)) throw new Error('JSON 格式不正确');
        // 记下每条有效标注在备份里的序号，旅程调整按这个序号找到对应的标注
        const validIndexes = entries.map((_, i) => i)
            .filter(i => Number.isFinite(Number(entries[i]?.latitude)) && Number.isFinite(Number(entries[i]?.longitude)));
        const valid = validIndexes.map(i => entries[i]);

        // 已经导入过的标注不重复创建，只给缺照片的补上照片（先导入 json、再导入 zip 的情况）
        const existing = new Map((await api.listPoints()).map(p => [pointKey(p.lat, p.lng, p.title), p]));
        const inputs = valid.map(toPointInput);
        const targets = inputs.map(input => existing.get(pointKey(input.lat, input.lng, input.title)) || null);
        const toCreate = inputs.map((_, i) => i).filter(i => !targets[i]);
        for (let i = 0; i < toCreate.length; i += BATCH_SIZE) {
            const chunk = toCreate.slice(i, i + BATCH_SIZE);
            const created = await api.createPoints(chunk.map(j => inputs[j]));
            chunk.forEach((j, k) => { targets[j] = created[k]; });
        }
        let photosAdded = 0;

        if (zip) {
            const zipFiles = indexZip(zip);
            for (const [index, entry] of valid.entries()) {
                status.update(t('importing', { current: index + 1, total: valid.length }));
                // 已经有照片的标注不再补，免得重复导入同一份备份时照片越来越多
                if (targets[index].photos?.length) continue;
                for (const path of entry.photoPaths || []) {
                    const zipFile = findZipFile(zipFiles, path);
                    if (!zipFile) {
                        console.warn('zip 中找不到照片:', path);
                        continue;
                    }
                    try {
                        const filename = path.split('/').pop();
                        const ext = filename.split('.').pop().toLowerCase();
                        // 必须带上 MIME 类型，否则服务器会拒收
                        let photo = new File([await zipFile.async('arraybuffer')], filename, { type: MIME_TYPES[ext] || 'image/jpeg' });
                        if (ext === 'heic') {
                            const prepared = await preparePhoto(photo);
                            photo = new File([prepared.blob], prepared.name, { type: 'image/jpeg' });
                        }
                        targets[index] = await api.addPhoto(targets[index].id, photo, photo.name);
                        photosAdded++;
                    } catch (err) {
                        console.warn('照片导入失败:', path, err);
                    }
                }
            }
        }

        const tracksResult = zip ? await importTracksFromZip(zip, status) : { added: 0, skipped: 0 };
        if (zip) {
            const targetOfEntry = new Map(validIndexes.map((entryIndex, k) => [entryIndex, targets[k]]));
            await importSettingsFromZip(zip, (entryIndex) => targetOfEntry.get(entryIndex)?.id);
        }

        addPoints(targets);
        showOnMap(targets);
        const skipped = valid.length - toCreate.length;
        const summary = [t('imported', { count: toCreate.length })];
        if (skipped) summary.push(t('importSkipped', { count: skipped }));
        if (photosAdded) summary.push(t('photosAttached', { count: photosAdded }));
        if (tracksResult.added) summary.push(t('tracksImported', { count: tracksResult.added }));
        if (tracksResult.skipped) summary.push(t('tracksSkipped', { count: tracksResult.skipped }));
        toast(summary.join(' · '), { duration: 5000 });
        if (!zip && valid.some(e => e.photoPaths?.length)) {
            toast(t('importJsonNoPhotos'), { duration: 12000 });
        }
    } catch (err) {
        toastError(t('importFailed'), err);
    } finally {
        status.close();
    }
}
