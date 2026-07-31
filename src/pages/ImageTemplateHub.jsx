import React, { useEffect, useMemo, useState } from 'react';
import {
    ArrowUp, Copy, Image as ImageIcon, Loader2, Pencil, Plus, Save,
    Search, Sparkles, Trash2, X,
} from 'lucide-react';
import {
    createImageTemplate, deleteImageTemplate, listImageTemplates, updateImageTemplate,
} from '../api/imageTemplates';
import {
    VOD_DEFAULT_IMAGE_MODEL_NAME, VOD_DEFAULT_IMAGE_MODEL_VERSION, VOD_IMAGE_MODEL_MATRIX,
} from '../vodAdapter';
import { getVodImageModelCapability } from '../data/vodImageModelCapabilities';
import { IMAGE_INSPIRATION_CATEGORIES } from '../data/imageInspiration';
import i18n from '../i18n';

const t = (value) => (i18n.t ? i18n.t(value) : value);
const MODEL_NAMES = Object.keys(VOD_IMAGE_MODEL_MATRIX);
const ACCENTS = {
    amber: 'from-amber-700 via-amber-400 to-yellow-200',
    slate: 'from-slate-900 via-slate-600 to-slate-200',
    rose: 'from-rose-700 via-rose-400 to-orange-200',
    violet: 'from-violet-800 via-fuchsia-500 to-pink-200',
    cyan: 'from-cyan-700 via-sky-400 to-cyan-100',
    emerald: 'from-emerald-800 via-emerald-400 to-lime-200',
    red: 'from-red-800 via-red-500 to-amber-200',
    indigo: 'from-indigo-950 via-indigo-600 to-sky-200',
};
const CUSTOM_CATEGORY = { id: 'custom', label: '我的模板' };
const CATEGORIES = [...IMAGE_INSPIRATION_CATEGORIES, CUSTOM_CATEGORY];
const EDITABLE_CATEGORIES = IMAGE_INSPIRATION_CATEGORIES.filter((item) => item.id !== 'all');

function defaultModelVersion(modelName) {
    const versions = VOD_IMAGE_MODEL_MATRIX[modelName] || [];
    return modelName === VOD_DEFAULT_IMAGE_MODEL_NAME && versions.includes(VOD_DEFAULT_IMAGE_MODEL_VERSION)
        ? VOD_DEFAULT_IMAGE_MODEL_VERSION
        : versions[0] || '';
}

function emptyTemplate() {
    const modelName = MODEL_NAMES.includes(VOD_DEFAULT_IMAGE_MODEL_NAME) ? VOD_DEFAULT_IMAGE_MODEL_NAME : MODEL_NAMES[0];
    const modelVersion = defaultModelVersion(modelName);
    const capability = getVodImageModelCapability(modelName, modelVersion);
    return {
        name: '', category: 'portrait', description: '', prompt: '',
        model_name: modelName, model_version: modelVersion,
        ratio: capability.defaultRatio, resolution: capability.defaultResolution,
        enhance_prompt: 'Enabled', storage_mode: 'Temporary', accent: 'amber', cover_url: '',
    };
}

function normalizeCustomTemplate(item) {
    return {
        ...item,
        id: `custom-${item.id}`,
        database_id: item.id,
        is_custom: true,
        accent_key: item.accent || 'amber',
        accent: ACCENTS[item.accent] || ACCENTS.amber,
    };
}

function safeCoverURL(value) {
    const url = String(value || '').trim();
    if (!url) return '';
    if (url.startsWith('/file/') || url.startsWith('/api/cache/')) return url;
    try {
        const parsed = new URL(url);
        return parsed.protocol === 'https:' ? parsed.href : '';
    } catch {
        return '';
    }
}

function TemplateEditor({ initialValue, saving, error, onSave, onClose }) {
    const [form, setForm] = useState(() => ({ ...emptyTemplate(), ...initialValue }));
    const versions = VOD_IMAGE_MODEL_MATRIX[form.model_name] || [];
    const capability = getVodImageModelCapability(form.model_name, form.model_version);
    const coverURL = safeCoverURL(form.cover_url);
    const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));

    useEffect(() => {
        const onKeyDown = (event) => { if (event.key === 'Escape' && !saving) onClose(); };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [onClose, saving]);

    const changeModel = (modelName) => {
        const modelVersion = defaultModelVersion(modelName);
        const nextCapability = getVodImageModelCapability(modelName, modelVersion);
        setForm((current) => ({
            ...current, model_name: modelName, model_version: modelVersion,
            ratio: nextCapability.defaultRatio, resolution: nextCapability.defaultResolution,
        }));
    };
    const changeVersion = (modelVersion) => {
        const nextCapability = getVodImageModelCapability(form.model_name, modelVersion);
        setForm((current) => ({
            ...current, model_version: modelVersion,
            ratio: nextCapability.ratios.includes(current.ratio) ? current.ratio : nextCapability.defaultRatio,
            resolution: nextCapability.resolutions.includes(current.resolution) ? current.resolution : nextCapability.defaultResolution,
        }));
    };
    const submit = (event) => {
        event.preventDefault();
        onSave({
            name: form.name.trim(), category: form.category, description: form.description.trim(),
            prompt: form.prompt.trim(), model_name: form.model_name, model_version: form.model_version,
            ratio: form.ratio, resolution: form.resolution, enhance_prompt: form.enhance_prompt,
            storage_mode: form.storage_mode, accent: form.accent_key || form.accent || 'amber',
            cover_url: form.cover_url.trim(),
        });
    };

    return (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/25 p-4 backdrop-blur-[2px]" role="dialog" aria-modal="true" aria-label={t(initialValue?.database_id ? '编辑图像模板' : '新建图像模板')}>
            <button type="button" className="absolute inset-0 cursor-default" onClick={() => !saving && onClose()} aria-label={t('关闭')} />
            <form onSubmit={submit} className="relative max-h-[92vh] w-full max-w-[820px] overflow-y-auto rounded-2xl border border-[#e8e1d3] bg-white shadow-[0_24px_80px_rgba(37,30,15,0.22)]">
                <header className="sticky top-0 z-10 flex items-center justify-between border-b border-[#eee9df] bg-white/95 px-6 py-4 backdrop-blur">
                    <div><h2 className="text-[16px] font-semibold text-[#302c24]">{t(initialValue?.database_id ? '编辑自定义模板' : '创建自定义模板')}</h2><p className="mt-1 text-[10.5px] text-gray-400">{t('完整配置会保存在本地数据库，可被所有浏览器访问')}</p></div>
                    <button type="button" onClick={onClose} disabled={saving} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100"><X size={17} /></button>
                </header>

                <div className="grid gap-6 p-6 lg:grid-cols-[1fr_260px]">
                    <div className="space-y-5">
                        <div className="grid gap-4 sm:grid-cols-2">
                            <label className="text-[11px] font-medium text-[#60594d]">{t('模板名称')}<input id="template-name" name="template-name" required maxLength={120} value={form.name} onChange={(e) => set('name', e.target.value)} placeholder={t('例如：产品高级棚拍')} className="mt-1.5 h-10 w-full rounded-lg border border-[#e5dfd3] px-3 text-[12px] outline-none focus:border-[#d2a640]" /></label>
                            <label className="text-[11px] font-medium text-[#60594d]">{t('分类')}<select id="template-category" name="template-category" value={form.category} onChange={(e) => set('category', e.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-[#e5dfd3] bg-white px-3 text-[12px] outline-none focus:border-[#d2a640]">{EDITABLE_CATEGORIES.map((item) => <option key={item.id} value={item.id}>{t(item.label)}</option>)}</select></label>
                        </div>
                        <label className="block text-[11px] font-medium text-[#60594d]">{t('模板描述')}<input maxLength={500} value={form.description} onChange={(e) => set('description', e.target.value)} placeholder={t('简要描述用途和视觉风格')} className="mt-1.5 h-10 w-full rounded-lg border border-[#e5dfd3] px-3 text-[12px] outline-none focus:border-[#d2a640]" /></label>
                        <label className="block text-[11px] font-medium text-[#60594d]">{t('完整提示词')}<textarea required maxLength={20000} rows={7} value={form.prompt} onChange={(e) => set('prompt', e.target.value)} placeholder={t('输入应用模板时自动带入的完整提示词')} className="mt-1.5 w-full resize-y rounded-xl border border-[#e5dfd3] px-3 py-2.5 text-[12px] leading-6 outline-none focus:border-[#d2a640]" /></label>

                        <section className="rounded-xl border border-[#ece6da] bg-[#fcfbf8] p-4">
                            <div className="mb-3 text-[11px] font-semibold text-[#4e493f]">{t('生成模型')}</div>
                            <div className="grid gap-3 sm:grid-cols-2">
                                <label className="text-[10.5px] text-gray-500">{t('模型')}<select id="template-model" name="template-model" value={form.model_name} onChange={(e) => changeModel(e.target.value)} className="mt-1 h-9 w-full rounded-lg border border-[#e2dccf] bg-white px-2.5 text-[11.5px] outline-none">{MODEL_NAMES.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
                                <label className="text-[10.5px] text-gray-500">{t('版本')}<select value={form.model_version} onChange={(e) => changeVersion(e.target.value)} className="mt-1 h-9 w-full rounded-lg border border-[#e2dccf] bg-white px-2.5 text-[11.5px] outline-none">{versions.map((version) => <option key={version} value={version}>{version}</option>)}</select></label>
                                <label className="text-[10.5px] text-gray-500">{t('画面比例')}<select id="template-ratio" name="template-ratio" value={form.ratio} onChange={(e) => set('ratio', e.target.value)} className="mt-1 h-9 w-full rounded-lg border border-[#e2dccf] bg-white px-2.5 text-[11.5px] outline-none">{capability.ratios.map((ratio) => <option key={ratio} value={ratio}>{ratio}</option>)}</select></label>
                                <label className="text-[10.5px] text-gray-500">{t('分辨率')}<select id="template-resolution" name="template-resolution" value={form.resolution} onChange={(e) => set('resolution', e.target.value)} disabled={!capability.resolutions.length} className="mt-1 h-9 w-full rounded-lg border border-[#e2dccf] bg-white px-2.5 text-[11.5px] outline-none disabled:bg-gray-100">{capability.resolutions.length ? capability.resolutions.map((resolution) => <option key={resolution} value={resolution}>{resolution}</option>) : <option value="">{t('模型自动')}</option>}</select></label>
                                <label className="text-[10.5px] text-gray-500">{t('提示词增强')}<select id="template-enhance" name="template-enhance" value={form.enhance_prompt} onChange={(e) => set('enhance_prompt', e.target.value)} className="mt-1 h-9 w-full rounded-lg border border-[#e2dccf] bg-white px-2.5 text-[11.5px] outline-none"><option value="Enabled">{t('开启')}</option><option value="Disabled">{t('关闭')}</option></select></label>
                                <label className="text-[10.5px] text-gray-500">{t('存储模式')}<select id="template-storage" name="template-storage" value={form.storage_mode} onChange={(e) => set('storage_mode', e.target.value)} className="mt-1 h-9 w-full rounded-lg border border-[#e2dccf] bg-white px-2.5 text-[11.5px] outline-none"><option value="Temporary">{t('临时存储')}</option><option value="Permanent">{t('永久存储')}</option></select></label>
                            </div>
                        </section>
                    </div>

                    <aside className="space-y-5">
                        <section><div className="mb-2 text-[11px] font-medium text-[#60594d]">{t('主题色')}</div><div className="grid grid-cols-4 gap-2">{Object.entries(ACCENTS).map(([key, accent]) => <button key={key} type="button" onClick={() => setForm((current) => ({ ...current, accent: key, accent_key: key }))} aria-label={key} className={`h-8 rounded-lg bg-gradient-to-r ${accent} ${(form.accent_key || form.accent) === key ? 'ring-2 ring-[#bd8a19] ring-offset-2' : 'opacity-70 hover:opacity-100'}`} />)}</div></section>
                        <label className="block text-[11px] font-medium text-[#60594d]">{t('封面 URL（可选）')}<input id="template-cover-url" name="template-cover-url" value={form.cover_url} onChange={(e) => set('cover_url', e.target.value)} placeholder="https://..." className="mt-1.5 h-10 w-full rounded-lg border border-[#e5dfd3] px-3 text-[11px] outline-none focus:border-[#d2a640]" /><span className="mt-1.5 block text-[9.5px] leading-4 text-gray-400">{t('支持 HTTPS 或本地 /file/ 缓存路径')}</span></label>
                        <div className="overflow-hidden rounded-2xl border border-[#e9e3d7] bg-white shadow-sm">
                            <div className={`relative aspect-[4/3] overflow-hidden bg-gradient-to-br ${ACCENTS[form.accent_key || form.accent] || ACCENTS.amber}`}>
                                {coverURL ? <img src={coverURL} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-white/70"><ImageIcon size={32} /></div>}
                                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/65 to-transparent px-4 pb-3 pt-10 text-white"><div className="text-[13px] font-semibold">{form.name || t('模板预览')}</div><div className="mt-1 truncate text-[9.5px] text-white/70">{form.model_name} {form.model_version} · {form.ratio} · {form.resolution || t('自动')}</div></div>
                            </div>
                        </div>
                    </aside>
                </div>

                {error && <div className="mx-6 mb-4 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-[11px] text-red-600">{error}</div>}
                <footer className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-[#eee9df] bg-white/95 px-6 py-4 backdrop-blur"><button type="button" onClick={onClose} disabled={saving} className="rounded-lg px-4 py-2 text-[11.5px] text-gray-500 hover:bg-gray-100">{t('取消')}</button><button type="submit" disabled={saving || !form.name.trim() || !form.prompt.trim()} className="flex items-center gap-2 rounded-lg bg-[#25231f] px-4 py-2 text-[11.5px] font-medium text-white hover:bg-black disabled:opacity-50">{saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}{t(saving ? '保存中' : '保存模板')}</button></footer>
            </form>
        </div>
    );
}

export default function ImageTemplateHub({ builtInStyles, onApply }) {
    const [customTemplates, setCustomTemplates] = useState([]);
    const [activeCategory, setActiveCategory] = useState('all');
    const [query, setQuery] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [editorValue, setEditorValue] = useState(null);
    const [saving, setSaving] = useState(false);
    const [editorError, setEditorError] = useState('');

    const load = async () => {
        setLoading(true); setError('');
        try { setCustomTemplates((await listImageTemplates()).map(normalizeCustomTemplate)); }
        catch (nextError) { setError(nextError?.message || '读取自定义模板失败'); }
        finally { setLoading(false); }
    };
    useEffect(() => { load(); }, []);

    const styles = useMemo(() => [...builtInStyles, ...customTemplates], [builtInStyles, customTemplates]);
    const normalizedQuery = query.trim().toLowerCase();
    const visibleStyles = styles.filter((style) => {
        const matchesCategory = activeCategory === 'all'
            || (activeCategory === 'custom' ? style.is_custom : style.category === activeCategory);
        const matchesQuery = !normalizedQuery || [style.name, style.description, style.prompt, style.model_name, style.model_version]
            .filter(Boolean).some((value) => String(value).toLowerCase().includes(normalizedQuery));
        return matchesCategory && matchesQuery;
    });

    const save = async (payload) => {
        setSaving(true); setEditorError('');
        try {
            if (editorValue?.database_id) await updateImageTemplate(editorValue.database_id, payload);
            else await createImageTemplate(payload);
            setEditorValue(null);
            await load();
            setActiveCategory('custom');
        } catch (nextError) { setEditorError(nextError?.message || '保存模板失败'); }
        finally { setSaving(false); }
    };
    const duplicate = async (style) => {
        setError('');
        try {
            await createImageTemplate({
                name: `${style.name} 副本`, category: style.category || 'portrait', description: style.description || '',
                prompt: style.prompt, model_name: style.model_name || VOD_DEFAULT_IMAGE_MODEL_NAME,
                model_version: style.model_version || VOD_DEFAULT_IMAGE_MODEL_VERSION,
                ratio: style.ratio || '1:1', resolution: style.resolution || '1K',
                enhance_prompt: style.enhance_prompt || 'Enabled', storage_mode: style.storage_mode || 'Temporary',
                accent: style.accent_key || 'amber', cover_url: style.cover_url || '',
            });
            await load(); setActiveCategory('custom');
        } catch (nextError) { setError(nextError?.message || '复制模板失败'); }
    };
    const remove = async (style) => {
        if (!window.confirm(t(`确定删除“${style.name}”吗？此操作不会删除生成历史。`))) return;
        setError('');
        try { await deleteImageTemplate(style.database_id); await load(); }
        catch (nextError) { setError(nextError?.message || '删除模板失败'); }
    };

    return (
        <div className="mx-auto w-full max-w-[1240px] px-6 py-10 lg:px-10">
            <section aria-labelledby="image-template-title">
                <div className="flex flex-col gap-5 border-b border-[#efede7] pb-7 lg:flex-row lg:items-end lg:justify-between">
                    <div><div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-[#b68112]"><span className="h-px w-7 bg-[#e2b849]" />Image Templates</div><h1 id="image-template-title" className="text-[28px] font-semibold tracking-[-0.02em] text-[#1f2329]">{t('图像模版')}</h1><p className="mt-2 text-[13px] text-gray-400">{t('使用内置灵感，或创建包含模型、参数与存储策略的完整自定义模板。')}</p></div>
                    <div className="flex w-full flex-col gap-2 sm:flex-row lg:w-auto">
                        <label className="flex w-full items-center gap-2 rounded-xl border border-[#e8e5dd] bg-[#fafaf8] px-3 py-2.5 text-gray-400 focus-within:border-[#d9b354] focus-within:bg-white lg:w-[300px]"><Search size={15} /><input id="image-template-search" name="image-template-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('搜索模版、模型或提示词')} className="w-full bg-transparent text-[12px] text-[#292722] outline-none" /></label>
                        <button type="button" onClick={() => { setEditorError(''); setEditorValue(emptyTemplate()); }} className="flex items-center justify-center gap-2 rounded-xl bg-[#25231f] px-4 py-2.5 text-[12px] font-medium text-white hover:bg-black"><Plus size={15} />{t('新建模板')}</button>
                    </div>
                </div>

                <div className="mt-5 flex gap-1 overflow-x-auto no-scrollbar" role="tablist" aria-label={t('图像模版分类')}>{CATEGORIES.map((category) => <button key={category.id} type="button" role="tab" aria-selected={activeCategory === category.id} onClick={() => setActiveCategory(category.id)} className={`whitespace-nowrap rounded-full px-3.5 py-2 text-[12px] transition ${activeCategory === category.id ? 'bg-[#f6e7b4] font-medium text-[#604914] shadow-sm' : 'text-gray-500 hover:bg-[#f5f4f1]'}`}>{t(category.label)}{category.id === 'custom' && customTemplates.length > 0 ? ` ${customTemplates.length}` : ''}</button>)}</div>
                {error && <div className="mt-4 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-[11px] text-red-600">{error}</div>}

                <div className="mt-7">
                    {loading ? <div className="flex h-48 items-center justify-center"><Loader2 size={22} className="animate-spin text-[#b68112]" /></div> : visibleStyles.length ? (
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">{visibleStyles.map((style) => {
                            const coverURL = safeCoverURL(style.cover_url);
                            return <article key={style.id} className="group relative min-h-[210px] overflow-hidden rounded-2xl border border-[#e9e5db] bg-white shadow-[0_3px_12px_rgba(45,37,17,0.035)] transition-all hover:-translate-y-0.5 hover:border-[#d9c991] hover:shadow-[0_15px_34px_rgba(57,49,24,0.11)]">
                                <button type="button" onClick={() => onApply(style)} className="absolute inset-0 z-0 text-left" aria-label={t(`应用模板 ${style.name}`)} />
                                <div className={`absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r ${style.accent || ACCENTS.amber}`} />
                                {coverURL ? <><img src={coverURL} alt="" className="absolute inset-0 h-full w-full object-cover opacity-20 transition duration-500 group-hover:scale-[1.03] group-hover:opacity-25" /><div className="absolute inset-0 bg-gradient-to-r from-white via-white/95 to-white/65" /></> : <div className={`absolute -right-8 -top-10 h-28 w-28 rounded-full bg-gradient-to-br opacity-15 blur-2xl ${style.accent || ACCENTS.amber}`} />}
                                <div className="pointer-events-none relative flex min-h-[210px] flex-col p-5">
                                    <div className="flex items-start justify-between gap-3"><div><div className="flex items-center gap-2"><h2 className="text-[16px] font-semibold text-[#292722]">{t(style.name)}</h2>{style.is_custom && <span className="rounded-full bg-[#f5ead0] px-2 py-0.5 text-[8.5px] font-semibold text-[#876417]">{t('自定义')}</span>}</div><p className="mt-1 text-[11.5px] font-medium text-[#aa8750]">{t(style.description)}</p></div><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#f8efcf] text-[#a97710]"><ArrowUp size={15} className="rotate-45" /></span></div>
                                    <p className="mt-4 line-clamp-3 text-[12px] leading-5 text-gray-400">{t(style.prompt)}</p>
                                    <div className="mt-auto flex items-end justify-between gap-3 pt-4"><div className="text-[9.5px] text-[#81765c]">{style.is_custom ? `${style.model_name} ${style.model_version} · ${style.ratio} · ${style.resolution || t('自动')}` : t('应用模版并开始创作')}</div>{style.is_custom && <div className="pointer-events-auto relative z-10 flex gap-1"><button type="button" onClick={() => { setEditorError(''); setEditorValue(style); }} title={t('编辑')} className="rounded-md p-1.5 text-gray-400 hover:bg-[#f5f2ea] hover:text-[#8d6816]"><Pencil size={13} /></button><button type="button" onClick={() => duplicate(style)} title={t('复制')} className="rounded-md p-1.5 text-gray-400 hover:bg-[#f5f2ea] hover:text-[#8d6816]"><Copy size={13} /></button><button type="button" onClick={() => remove(style)} title={t('删除')} className="rounded-md p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500"><Trash2 size={13} /></button></div>}</div>
                                </div>
                            </article>;
                        })}</div>
                    ) : <div className="rounded-2xl border border-dashed border-[#e6e1d5] py-16 text-center"><Sparkles size={24} className="mx-auto text-[#d2b56e]" /><div className="mt-3 text-[13px] text-gray-400">{t(activeCategory === 'custom' ? '还没有自定义模板，点击“新建模板”开始创建' : '没有找到匹配的图像模版')}</div></div>}
                </div>
            </section>
            {editorValue && <TemplateEditor initialValue={editorValue} saving={saving} error={editorError} onSave={save} onClose={() => !saving && setEditorValue(null)} />}
        </div>
    );
}
