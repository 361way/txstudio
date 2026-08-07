import { GPT_IMAGE2_CASES } from './gptImage2Cases';

export const IMAGE_INSPIRATION_CATEGORIES = [
    { id: 'all', label: '全部' },
    { id: 'portrait', label: '人像写真' },
    { id: 'brand', label: '品牌商业' },
    { id: 'illustration', label: '插画叙事' },
    { id: 'craft', label: '创意质感' },
    { id: 'festival', label: '节日海报' },
];

// 图像模版中心使用的完整分类（首页预览仍沿用上面的精简分类）。
// 新增分类来自 awesome-gpt-image-2 案例库；近似分类已合并到 portrait/brand/illustration。
export const IMAGE_TEMPLATE_CATEGORIES = [
    ...IMAGE_INSPIRATION_CATEGORIES,
    { id: 'poster', label: '海报设计' },
    { id: 'infographic', label: '图表信息' },
    { id: 'ui', label: '界面设计' },
    { id: 'architecture', label: '建筑空间' },
    { id: 'history', label: '历史古典' },
    { id: 'documents', label: '文档出版' },
    { id: 'other', label: '其他创意' },
];

// 图像模版灵感库：选中后将 prompt 作为风格补充词带入图像创作。
export const IMAGE_INSPIRATIONS = [
    {
        id: 'mens-editorial-portrait',
        category: 'portrait',
        name: '男士商业肖像',
        description: '电影感 · 高级影棚',
        accent: 'from-slate-800 via-slate-600 to-amber-300',
        prompt: '专业男性商业肖像，定制深色西装，简洁纯色影棚背景，伦勃朗式侧光与暖色轮廓光，克制自信的姿态，电影级色彩分级，高分辨率细节。',
    },
    {
        id: 'womens-studio-portrait',
        category: 'portrait',
        name: '女士坐姿影棚照',
        description: '柔光 · 时尚杂志',
        accent: 'from-rose-300 via-orange-200 to-stone-100',
        prompt: '高级时尚杂志肖像，一位女性优雅坐姿，干净单色影棚背景，柔和均匀的棚拍光线，自然精致妆容，得体套装，专业而亲和的画面气质。',
    },
    {
        id: 'fashion-cover',
        category: 'portrait',
        name: '都市时尚封面',
        description: '摩登 · 编辑感',
        accent: 'from-fuchsia-600 via-rose-400 to-orange-200',
        prompt: '都市时尚杂志封面构图，现代建筑与城市街景背景，强烈而干净的时尚造型，利落轮廓光，精致排版留白，摩登高饱和色彩，编辑摄影质感。',
    },
    {
        id: 'cinematic-storyboard',
        category: 'portrait',
        name: '电影感分镜',
        description: '叙事 · 多镜头',
        accent: 'from-indigo-950 via-violet-700 to-amber-300',
        prompt: '电影叙事分镜画面，连续的近景、中景与远景镜头语言，戏剧化光影，统一的人物与服装连续性，具有故事张力的构图，胶片色彩与细腻颗粒感。',
    },
    {
        id: 'premium-brand',
        category: 'brand',
        name: '高奢品牌视觉',
        description: '极简 · 精致陈列',
        accent: 'from-zinc-950 via-zinc-700 to-amber-400',
        prompt: '高奢品牌广告视觉，极简空间与克制留白，精致材质特写，深色背景配金属高光，产品居中陈列，冷暖对比的高级灯光，干净无杂物。',
    },
    {
        id: 'brand-vi',
        category: 'brand',
        name: '极简品牌 VI',
        description: '包装 · 平铺展示',
        accent: 'from-pink-300 via-rose-200 to-white',
        prompt: '极简品牌视觉识别展示，统一的品牌标志、包装盒、杯具、手提袋、卡片与文具，整齐俯拍平铺布局，柔和撞色，干净背景，清新专业的商业摄影。',
    },
    {
        id: 'metal-logo',
        category: 'brand',
        name: '金属 Logo',
        description: '3D · 镜面质感',
        accent: 'from-zinc-500 via-slate-200 to-cyan-100',
        prompt: '立体金属品牌标志，镜面镀铬与拉丝材质结合，边缘清晰，深色空间背景，柔和反射与戏剧性聚光，精密 3D 产品渲染，构图简洁。',
    },
    {
        id: 'inflated-poster',
        category: 'brand',
        name: '膨胀海报设计',
        description: '视觉字体 · 潮流',
        accent: 'from-cyan-400 via-blue-500 to-violet-600',
        prompt: '潮流视觉海报，夸张的膨胀立体字与流体形状，明亮渐变色彩，半透明材质与柔和阴影，现代排版，强烈视觉中心，干净的图形设计语言。',
    },
    {
        id: 'four-panel-comic',
        category: 'illustration',
        name: 'AI 四宫格漫画',
        description: '表情 · 漫画分镜',
        accent: 'from-red-500 via-orange-400 to-yellow-200',
        prompt: '四宫格手绘漫画布局，同一主体呈现四种鲜明情绪和动作，动态速度线、手绘拟声元素与对话框，鲜亮配色，漫画网点与纸张纹理，画面具有强节奏感。',
    },
    {
        id: 'paper-cut-poster',
        category: 'illustration',
        name: '剪纸风海报',
        description: '国潮 · 层叠纸雕',
        accent: 'from-red-700 via-red-500 to-amber-300',
        prompt: '中式剪纸纸雕海报，多层镂空纸张形成空间纵深，祥云、花卉与建筑轮廓，红金主色，细腻压纹和烫金工艺质感，现代国潮排版，画面喜庆而有留白。',
    },
    {
        id: 'chinese-ink-type',
        category: 'illustration',
        name: '黑白毛笔字',
        description: '水墨 · 书法构成',
        accent: 'from-zinc-950 via-zinc-600 to-stone-200',
        prompt: '黑白水墨书法视觉，粗细变化鲜明的毛笔笔触，大面积留白与泼墨飞白，抽象化汉字构成，纸张纤维质感，东方极简美学，现代海报排版。',
    },
    {
        id: 'scene-storyboard',
        category: 'illustration',
        name: '多视角故事分镜',
        description: '角色一致 · 镜头组',
        accent: 'from-sky-950 via-blue-600 to-sky-200',
        prompt: '多视角故事分镜组图，保持人物、服装和场景一致，依次呈现环境远景、人物中景、表情近景与关键细节，清晰镜头节奏，专业影视概念设计。',
    },
    {
        id: 'miniature-house',
        category: 'craft',
        name: '治愈微缩小屋',
        description: '微距 · 温暖手作',
        accent: 'from-emerald-700 via-lime-400 to-amber-200',
        prompt: '治愈系微缩小屋，精巧手作模型，木质家具、暖色小灯、植物与生活小物，微距摄影，浅景深，柔和自然光，细节丰富，营造温暖安静的故事感。',
    },
    {
        id: 'miniature-store',
        category: 'craft',
        name: '微缩主题店铺',
        description: '模型 · 街景细节',
        accent: 'from-amber-700 via-orange-400 to-teal-300',
        prompt: '高精度微缩主题店铺场景，富有年代感的招牌、木门窗、户外桌椅与盆栽，微距镜头，暖棕和灰绿色调，真实景深，精致手作模型的材质细节。',
    },
    {
        id: 'acrylic-charm',
        category: 'craft',
        name: '照片变创意挂件',
        description: '亚克力 · 日常潮物',
        accent: 'from-violet-500 via-pink-400 to-cyan-300',
        prompt: '将主体设计为可爱的扁平亚克力挂件，透明边缘与轻微反光，精细金属挂环，悬挂在日常包袋上，真实产品摄影，清爽背景，突出挂件图案与材质。',
    },
    {
        id: 'texture-acrylic-type',
        category: 'craft',
        name: '颗粒亚克力字',
        description: '材质 · 节日祝福',
        accent: 'from-rose-600 via-red-400 to-amber-200',
        prompt: '立体颗粒亚克力艺术字，半透明树脂与细小亮片材质，圆润饱满的字形，鲜明节日配色，柔和投影，正面海报构图，精致 3D 渲染。',
    },
    {
        id: 'new-year-cover',
        category: 'festival',
        name: '新春国潮封面',
        description: '红金 · 传统新意',
        accent: 'from-red-800 via-red-500 to-yellow-300',
        prompt: '新春国潮主题封面，浓郁红金配色，毛笔书法主标题，祥云、灯笼、烟花与传统纹样，局部烫金和立体纸雕效果，喜庆但不拥挤，高级节日视觉。',
    },
    {
        id: 'paper-lantern',
        category: 'festival',
        name: '剪纸灯笼',
        description: '镂空 · 国风立体',
        accent: 'from-red-700 via-orange-500 to-amber-200',
        prompt: '立体剪纸灯笼为视觉中心，灯笼内部呈现山水、建筑与红枫剪影，背景叠加祥云镂空纹理，红色纸艺层层递进，柔和发光，国风节庆海报。',
    },
    {
        id: 'family-reunion-paper',
        category: 'festival',
        name: '剪纸合家欢',
        description: '团圆 · 金红纸雕',
        accent: 'from-amber-500 via-red-500 to-red-800',
        prompt: '金红双色剪纸纸雕场景，一家人围桌团圆，窗花、灯笼、烟花与祥云环绕，层叠纸张形成纵深，细腻压印与金箔质感，温暖喜庆的春节氛围。',
    },
    {
        id: 'metal-blessing-type',
        category: 'festival',
        name: '金属字贺词',
        description: '艺术字 · 高级喜庆',
        accent: 'from-black via-stone-800 to-amber-400',
        prompt: '高级金属艺术字贺词，厚重立体的字形与精细金色纹理，黑色或深红背景，局部红色印章与极简英文点缀，戏剧光影，现代东方节日海报。',
    },
];

// 主页“灵感”快捷提示词，基于参考页面的公开可见快捷项。
export const HOME_QUICK_INSPIRATIONS = [
    {
        id: 'figure-toy',
        name: '图片变手办',
        prompt: '将这张照片变成一个人物手办。在它后面，放置一个印有角色形象的盒子，以及一台屏幕上显示着Blender建模过程的电脑。在盒子前面，加一个圆形的塑料底座，上面站着角色手办。如果可能的话，将场景设置在室内',
    },
    {
        id: 'change-person-angle',
        name: '改变人物视角',
        prompt: '将相机角度改为高角度自拍视角，俯视女性，同时保留她确切的面部特征、表情和服装，保持相同的客厅室内背景、沙发、自然光以及整体的摄影构图和风格。',
    },
    {
        id: 'architecture-to-model',
        name: '建筑变模型',
        prompt: '将这张照片转换成一个建筑模型。模型后面应该有一个纸板箱，上面印有照片中建筑的图片。还应该有一台电脑，电脑屏幕上显示着该模型的Blender建模过程。在纸板箱前面，放置一张卡纸，并把照片中的建筑模型放在上面。我希望PVC材质能清晰呈现。如果背景是室内的就更好了。',
    },
    {
        id: 'combine-objects',
        name: '组合对象',
        prompt: '把它们组合起来',
    },
    {
        id: 'hd-restoration',
        name: '高清修复',
        prompt: '将此图片增强为高分辨率',
    },
    {
        id: 'image-to-line-art',
        name: '图片转线稿',
        prompt: '变成线稿手绘图',
    },
    {
        id: 'palette-coloring',
        name: '使用调色板上色',
        prompt: '准确使用色卡上色',
    },
    {
        id: 'character-design',
        name: '生成角色设定',
        prompt: '为我生成人物的角色设定（Character Design）\n\n比例设定（不同身高对比、头身比等）\n\n三视图（正面、侧面、背面）\n\n表情设定（Expression Sheet）\n\n动作设定（Pose Sheet） → 各种常见姿势\n\n服装设定（Costume Design）',
    },
];

export function buildStyledImagePrompt(basePrompt, inspiration) {
    return [basePrompt?.trim(), inspiration?.prompt?.trim()].filter(Boolean).join('\n\n');
}

// 图像模版中心的完整模版集 = 内置灵感 + 导入的 awesome-gpt-image-2 案例。
export const IMAGE_TEMPLATE_STYLES = [...IMAGE_INSPIRATIONS, ...GPT_IMAGE2_CASES];
