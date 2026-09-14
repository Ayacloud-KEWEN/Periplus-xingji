// 分类图标：数据库和备份里仍然用 emoji 作为分类标识，这里把它映射成 SVG 图标和颜色。
// 图标来自 Lucide v1.44.0（ISC License，https://lucide.dev），由 lucide-static 包里的 SVG 原样提取。

export const CATEGORIES = [
    { emoji: "📍", icon: "map-pin", color: "#5a3e2b" },
    { emoji: "🍽️", icon: "utensils", color: "#e8590c" },
    { emoji: "🛍️", icon: "shopping-bag", color: "#d6336c" },
    { emoji: "🌲", icon: "tree-pine", color: "#2b8a3e" },
    { emoji: "🏞️", icon: "trees", color: "#37b24d" },
    { emoji: "🏠", icon: "house", color: "#7048e8" },
    { emoji: "🏨", icon: "bed-double", color: "#845ef7" },
    { emoji: "🏛️", icon: "landmark", color: "#a0522d" },
    { emoji: "🏰", icon: "castle", color: "#9c6644" },
    { emoji: "🏖️", icon: "tree-palm", color: "#1098ad" },
    { emoji: "⛳", icon: "flag", color: "#0ca678" },
    { emoji: "⛷️", icon: "mountain-snow", color: "#1c7ed6" },
    { emoji: "🐦", icon: "bird", color: "#66a80f" },
    { emoji: "🎣", icon: "fish", color: "#1971c2" },
    { emoji: "⛰️", icon: "mountain", color: "#5c940d" },
    { emoji: "🏢", icon: "building-2", color: "#495057" },
    { emoji: "🎭", icon: "drama", color: "#ae3ec9" },
    { emoji: "⛪", icon: "church", color: "#862e9c" },
    { emoji: "🏫", icon: "graduation-cap", color: "#1864ab" },
    { emoji: "🏥", icon: "hospital", color: "#e03131" },
    { emoji: "⛽", icon: "fuel", color: "#f08c00" },
    { emoji: "🚆", icon: "train-front", color: "#364fc7" },
    { emoji: "✈️", icon: "plane", color: "#0b7285" },
    { emoji: "📷", icon: "camera", color: "#e64980" }
];

const ICONS = {
    "map-pin": "<path d=\"M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0\" /><circle cx=\"12\" cy=\"10\" r=\"3\" />",
    "utensils": "<path d=\"M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2\" /><path d=\"M7 2v20\" /><path d=\"M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7\" />",
    "shopping-bag": "<path d=\"M16 10a4 4 0 0 1-8 0\" /><path d=\"M3.103 6.034h17.794\" /><path d=\"M3.4 5.467a2 2 0 0 0-.4 1.2V20a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6.667a2 2 0 0 0-.4-1.2l-2-2.667A2 2 0 0 0 17 2H7a2 2 0 0 0-1.6.8z\" />",
    "tree-pine": "<path d=\"m17 14 3 3.3a1 1 0 0 1-.7 1.7H4.7a1 1 0 0 1-.7-1.7L7 14h-.3a1 1 0 0 1-.7-1.7L9 9h-.2A1 1 0 0 1 8 7.3L12 3l4 4.3a1 1 0 0 1-.8 1.7H15l3 3.3a1 1 0 0 1-.7 1.7H17Z\" /><path d=\"M12 22v-3\" />",
    "trees": "<path d=\"M10 10v.2A3 3 0 0 1 8.9 16H5a3 3 0 0 1-1-5.8V10a3 3 0 0 1 6 0Z\" /><path d=\"M7 16v6\" /><path d=\"M13 19v3\" /><path d=\"M12 19h8.3a1 1 0 0 0 .7-1.7L18 14h.3a1 1 0 0 0 .7-1.7L16 9h.2a1 1 0 0 0 .8-1.7L13 3l-1.4 1.5\" />",
    "house": "<path d=\"M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8\" /><path d=\"M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z\" />",
    "bed-double": "<path d=\"M2 20v-8a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v8\" /><path d=\"M4 10V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v4\" /><path d=\"M12 4v6\" /><path d=\"M2 18h20\" />",
    "landmark": "<path d=\"M10 18v-7\" /><path d=\"M11.119 2.205a2 2 0 0 1 1.762 0l7.84 3.846A.5.5 0 0 1 20.5 7h-17a.5.5 0 0 1-.22-.949z\" /><path d=\"M14 18v-7\" /><path d=\"M18 18v-7\" /><path d=\"M3 22h18\" /><path d=\"M6 18v-7\" />",
    "castle": "<path d=\"M10 5V3\" /><path d=\"M14 5V3\" /><path d=\"M15 21v-3a3 3 0 0 0-6 0v3\" /><path d=\"M18 3v8\" /><path d=\"M18 5H6\" /><path d=\"M22 11H2\" /><path d=\"M22 9v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9\" /><path d=\"M6 3v8\" />",
    "tree-palm": "<path d=\"M13 8c0-2.76-2.46-5-5.5-5S2 5.24 2 8h2l1-1 1 1h4\" /><path d=\"M13 7.14A5.82 5.82 0 0 1 16.5 6c3.04 0 5.5 2.24 5.5 5h-3l-1-1-1 1h-3\" /><path d=\"M5.89 9.71c-2.15 2.15-2.3 5.47-.35 7.43l4.24-4.25.7-.7.71-.71 2.12-2.12c-1.95-1.96-5.27-1.8-7.42.35\" /><path d=\"M11 15.5c.5 2.5-.17 4.5-1 6.5h4c2-5.5-.5-12-1-14\" />",
    "flag": "<path d=\"M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10a1 1 0 0 1-.4.8A6 6 0 0 1 16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528\" />",
    "mountain-snow": "<path d=\"m8 3 4 8 5-5 5 15H2L8 3z\" /><path d=\"M4.14 15.08c2.62-1.57 5.24-1.43 7.86.42 2.74 1.94 5.49 2 8.23.19\" />",
    "bird": "<path d=\"M16 7h.01\" /><path d=\"M3.4 18H12a8 8 0 0 0 8-8V7a4 4 0 0 0-7.28-2.3L2 20\" /><path d=\"m20 7 2 .5-2 .5\" /><path d=\"M10 18v3\" /><path d=\"M14 17.75V21\" /><path d=\"M7 18a6 6 0 0 0 3.84-10.61\" />",
    "fish": "<path d=\"M6.5 12c.94-3.46 4.94-6 8.5-6 3.56 0 6.06 2.54 7 6-.94 3.47-3.44 6-7 6s-7.56-2.53-8.5-6Z\" /><path d=\"M18 12v.5\" /><path d=\"M16 17.93a9.77 9.77 0 0 1 0-11.86\" /><path d=\"M7 10.67C7 8 5.58 5.97 2.73 5.5c-1 1.5-1 5 .23 6.5-1.24 1.5-1.24 5-.23 6.5C5.58 18.03 7 16 7 13.33\" /><path d=\"M10.46 7.26C10.2 5.88 9.17 4.24 8 3h5.8a2 2 0 0 1 1.98 1.67l.23 1.4\" /><path d=\"m16.01 17.93-.23 1.4A2 2 0 0 1 13.8 21H9.5a5.96 5.96 0 0 0 1.49-3.98\" />",
    "mountain": "<path d=\"m8 3 4 8 5-5 5 15H2L8 3z\" />",
    "building-2": "<path d=\"M10 12h4\" /><path d=\"M10 8h4\" /><path d=\"M14 21v-3a2 2 0 0 0-4 0v3\" /><path d=\"M6 10H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-2\" /><path d=\"M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16\" />",
    "drama": "<path d=\"M10 11h.01\" /><path d=\"M14 6h.01\" /><path d=\"M18 6h.01\" /><path d=\"M6.5 13.1h.01\" /><path d=\"M22 5c0 9-4 12-6 12s-6-3-6-12c0-2 2-3 6-3s6 1 6 3\" /><path d=\"M17.4 9.9c-.8.8-2 .8-2.8 0\" /><path d=\"M10.1 7.1C9 7.2 7.7 7.7 6 8.6c-3.5 2-4.7 3.9-3.7 5.6 4.5 7.8 9.5 8.4 11.2 7.4.9-.5 1.9-2.1 1.9-4.7\" /><path d=\"M9.1 16.5c.3-1.1 1.4-1.7 2.4-1.4\" />",
    "church": "<path d=\"M10 9h4\" /><path d=\"M12 7v5\" /><path d=\"M14 21v-3a2 2 0 0 0-4 0v3\" /><path d=\"m18 9 3.52 2.147a1 1 0 0 1 .48.854V19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6.999a1 1 0 0 1 .48-.854L6 9\" /><path d=\"M6 21V7a1 1 0 0 1 .376-.782l5-3.999a1 1 0 0 1 1.249.001l5 4A1 1 0 0 1 18 7v14\" />",
    "graduation-cap": "<path d=\"M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z\" /><path d=\"M22 10v6\" /><path d=\"M6 12.5V16a6 3 0 0 0 12 0v-3.5\" />",
    "hospital": "<path d=\"M12 7v4\" /><path d=\"M14 21v-3a2 2 0 0 0-4 0v3\" /><path d=\"M14 9h-4\" /><path d=\"M18 11h2a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2h2\" /><path d=\"M18 21V5a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16\" />",
    "fuel": "<path d=\"M14 13h2a2 2 0 0 1 2 2v2a2 2 0 0 0 4 0v-6.998a2 2 0 0 0-.59-1.42L18 5\" /><path d=\"M14 21V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v16\" /><path d=\"M2 21h13\" /><path d=\"M3 9h11\" />",
    "train-front": "<path d=\"M8 3.1V7a4 4 0 0 0 8 0V3.1\" /><path d=\"m9 15-1-1\" /><path d=\"m15 15 1-1\" /><path d=\"M9 19c-2.8 0-5-2.2-5-5v-4a8 8 0 0 1 16 0v4c0 2.8-2.2 5-5 5Z\" /><path d=\"m8 19-2 3\" /><path d=\"m16 19 2 3\" />",
    "plane": "<path d=\"M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z\" />",
    "camera": "<path d=\"M13.997 4a2 2 0 0 1 1.76 1.05l.486.9A2 2 0 0 0 18.003 7H20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1.997a2 2 0 0 0 1.759-1.048l.489-.904A2 2 0 0 1 10.004 4z\" /><circle cx=\"12\" cy=\"13\" r=\"3\" />"
};

const byEmoji = new Map(CATEGORIES.map(category => [category.emoji, category]));

// 旧数据里不在列表中的 emoji 按"通用"显示
export function categoryOf(emoji) {
    return byEmoji.get(emoji) || CATEGORIES[0];
}

// 界面里用的小图标（线条颜色随文字颜色）
export function iconSvg(emoji) {
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><use href="#cat-${categoryOf(emoji).icon}"/></svg>`;
}

// 把图标注册成页面里的 <symbol>，之后用 <use href="#cat-xxx"> 引用
document.body.insertAdjacentHTML("beforeend",
    `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>${Object.entries(ICONS)
        .map(([name, body]) => `<symbol id="cat-${name}" viewBox="0 0 24 24">${body}</symbol>`).join("")}</defs></svg>`);
