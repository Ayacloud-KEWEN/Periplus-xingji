// 国家/地区代码（ISO 3166-1 alpha-2）→ 大洲。按联合国地理分区：俄罗斯归欧洲，土耳其、塞浦路斯、高加索三国归亚洲。
const CONTINENTS = {
    AF: 'dz ao bj bw bf bi cv cm cf td km cg cd ci dj eg gq er sz et ga gm gh gn gw ke ls lr ly mg mw ml mr mu yt ma mz na ne ng re rw sh st sn sc sl so za ss sd tz tg tn ug eh zm zw',
    AS: 'af am az bh bd bt bn kh cn cy ge hk in id ir iq il jp jo kz kw kg la lb mo my mv mn mm np kp om pk ps ph qa sa sg kr lk sy tw tj th tl tr tm ae uz vn ye io',
    EU: 'ax al ad at by be ba bg hr cz dk ee fo fi fr de gi gr gg hu is ie im it je xk lv li lt lu mt md mc me nl mk no pl pt ro ru sm rs sk si es sj se ch ua gb va',
    NA: 'ai ag aw bs bb bz bm bq vg ca ky cr cu cw dm do sv gl gd gp gt ht hn jm mq mx ms ni pa pr bl kn lc mf pm vc sx tt tc us vi',
    SA: 'ar bo bv br cl co ec fk gf gy py pe gs sr uy ve',
    OC: 'as au ck fj pf gu ki mh fm nr nc nz nu nf mp pw pg pn ws sb tk to tv um vu wf',
    AN: 'aq tf hm'
};

const byCountry = new Map();
for (const [continent, codes] of Object.entries(CONTINENTS)) {
    for (const code of codes.split(' ')) byCountry.set(code, continent);
}

export const CONTINENT_CODES = Object.keys(CONTINENTS);

// 手动修改所在地区时，前端的国家 / 地区下拉列表
export const COUNTRY_CODES = [...byCountry.keys()].sort();

export function continentOf(countryCode) {
    return byCountry.get(String(countryCode || '').toLowerCase()) || null;
}
