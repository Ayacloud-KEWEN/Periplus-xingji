// 照片处理：读取 EXIF、HEIC 转换、压缩。相关库较大（heic2any 1.3MB），用到时才加载。
import { loadScript } from './ui.js';

const VENDOR = 'vendor/libs/';
export const PHOTO_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,image/heic,.heic';

function isHeic(file) {
    return /heic|heif/i.test(file.type) || /\.hei[cf]$/i.test(file.name || '');
}

// 读取 GPS 坐标和拍摄时间；没有 GPS 时 lat/lng 为 null
export async function readPhotoMeta(file) {
    await loadScript(VENDOR + 'exifr.full.umd.js');
    let data = null;
    try {
        data = await window.exifr.parse(file, { gps: true });
    } catch (err) {
        console.warn('EXIF 读取失败:', file.name, err);
    }
    const date = data?.DateTimeOriginal || data?.CreateDate || null;
    return {
        lat: Number.isFinite(data?.latitude) ? data.latitude : null,
        lng: Number.isFinite(data?.longitude) ? data.longitude : null,
        date: date instanceof Date && !Number.isNaN(date.getTime()) ? date : null
    };
}

// 转成适合上传的图片：HEIC 转 JPEG，再压缩到 1MB / 1920px 以内
export async function preparePhoto(file) {
    let blob = file;
    let name = file.name || 'photo.jpg';

    if (isHeic(file)) {
        await loadScript(VENDOR + 'heic2any.min.js');
        const converted = await window.heic2any({ blob: file, toType: 'image/jpeg', quality: 0.85 });
        blob = Array.isArray(converted) ? converted[0] : converted;
        name = name.replace(/\.hei[cf]$/i, '.jpg');
    }

    await loadScript(VENDOR + 'browser-image-compression.js');
    try {
        const input = blob instanceof File ? blob : new File([blob], name, { type: blob.type || 'image/jpeg' });
        blob = await window.imageCompression(input, {
            maxSizeMB: 1,
            maxWidthOrHeight: 1920,
            initialQuality: 0.8,
            useWebWorker: true,
            // 默认会从 CDN 加载 worker 脚本，改为本地文件，局域网离线也能用
            libURL: new URL(VENDOR + 'browser-image-compression.js', location.href).href
        });
    } catch (err) {
        console.warn('压缩失败，上传原图:', err);
    }
    return { blob, name };
}
