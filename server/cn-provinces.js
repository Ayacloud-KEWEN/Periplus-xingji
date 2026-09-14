// 中国省级行政区：ISO 3166-2 代码 → 名称。
// OSM 里北京、上海这类直辖市的地址没有 state 字段，只带 ISO3166-2-lvl4 代码，靠这张表补上省级名称。
export const CN_PROVINCES = {
    'CN-BJ': '北京市', 'CN-TJ': '天津市', 'CN-HE': '河北省', 'CN-SX': '山西省', 'CN-NM': '内蒙古自治区',
    'CN-LN': '辽宁省', 'CN-JL': '吉林省', 'CN-HL': '黑龙江省', 'CN-SH': '上海市', 'CN-JS': '江苏省',
    'CN-ZJ': '浙江省', 'CN-AH': '安徽省', 'CN-FJ': '福建省', 'CN-JX': '江西省', 'CN-SD': '山东省',
    'CN-HA': '河南省', 'CN-HB': '湖北省', 'CN-HN': '湖南省', 'CN-GD': '广东省', 'CN-GX': '广西壮族自治区',
    'CN-HI': '海南省', 'CN-CQ': '重庆市', 'CN-SC': '四川省', 'CN-GZ': '贵州省', 'CN-YN': '云南省',
    'CN-XZ': '西藏自治区', 'CN-SN': '陕西省', 'CN-GS': '甘肃省', 'CN-QH': '青海省', 'CN-NX': '宁夏回族自治区',
    'CN-XJ': '新疆维吾尔自治区'
};

// 直辖市：省级和市级是同一个名称
export const CN_MUNICIPALITIES = new Set(['CN-BJ', 'CN-TJ', 'CN-SH', 'CN-CQ']);

// 香港、澳门在 OSM 里的国家代码是 cn，用 ISO3166-2-lvl3 区分，按"国家和地区"单独统计
export const CN_SPECIAL_REGIONS = { 'CN-HK': 'hk', 'CN-MO': 'mo' };
