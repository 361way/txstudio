// 图像模板的分类与首页快捷提示词。完整模板元数据由后端 SQLite 提供。
export const IMAGE_INSPIRATION_CATEGORIES = [
    { id: 'all', label: '全部' },
    { id: 'portrait', label: '人像写真' },
    { id: 'brand', label: '品牌商业' },
    { id: 'illustration', label: '插画叙事' },
    { id: 'craft', label: '创意质感' },
    { id: 'festival', label: '节日海报' },
];

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
    { id: 'combine-objects', name: '组合对象', prompt: '把它们组合起来' },
    { id: 'hd-restoration', name: '高清修复', prompt: '将此图片增强为高分辨率' },
    { id: 'image-to-line-art', name: '图片转线稿', prompt: '变成线稿手绘图' },
    { id: 'palette-coloring', name: '使用调色板上色', prompt: '准确使用色卡上色' },
    {
        id: 'character-design',
        name: '生成角色设定',
        prompt: '为我生成人物的角色设定（Character Design）\n\n比例设定（不同身高对比、头身比等）\n\n三视图（正面、侧面、背面）\n\n表情设定（Expression Sheet）\n\n动作设定（Pose Sheet） → 各种常见姿势\n\n服装设定（Costume Design）',
    },
];
