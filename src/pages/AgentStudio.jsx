import React, { useMemo, useRef, useState } from 'react';
import {
    Bot, Check, ChevronDown, Circle, Film, Image as ImageIcon, Loader2,
    Play, RotateCcw, Sparkles, Square, UserRound, Volume2, VolumeX,
} from 'lucide-react';
import {
    VOD_DEFAULT_IMAGE_MODEL_NAME,
    VOD_DEFAULT_IMAGE_MODEL_VERSION,
    VOD_DEFAULT_VIDEO_MODEL_NAME,
    VOD_DEFAULT_VIDEO_MODEL_VERSION,
    VOD_IMAGE_MODEL_MATRIX,
    VOD_VIDEO_MODEL_MATRIX,
    VOD_VIDEO_RATIOS,
} from '../vodAdapter';
import { getAgentTextModels, runScriptAgentLoop } from '../api/agentLoop';
import i18n from '../i18n';

const t = (value) => (i18n.t ? i18n.t(value) : value);
const RESOLUTIONS = ['720P', '1080P', '4K'];
const DURATIONS = ['5s', '10s'];
const STAGE_LABELS = {
    extracting_characters: '分析剧本与提取人物',
    generating_characters: '生成人物设定',
    planning_storyboard: '规划镜头与分镜',
    generating_storyboards: '生成分镜画面',
    generating_videos: '生成视频片段',
    completed: 'AgentLoop 已完成',
    failed: 'AgentLoop 运行失败',
    stopped: 'AgentLoop 已停止',
};
const PIPELINE_STEPS = [
    { id: 'extracting_characters', label: '人物提取', icon: UserRound },
    { id: 'generating_characters', label: '人物生成', icon: ImageIcon },
    { id: 'planning_storyboard', label: '分镜规划', icon: Sparkles },
    { id: 'generating_storyboards', label: '分镜生成', icon: ImageIcon },
    { id: 'generating_videos', label: '视频片段', icon: Film },
];

const selectClass = 'h-10 w-full rounded-lg border border-[#e6e1d6] bg-white px-3 text-[12.5px] text-[#36332d] outline-none transition focus:border-[#d4aa42] focus:ring-2 focus:ring-[#f5e7bd] disabled:bg-[#f5f4f1] disabled:text-gray-400';

function modelDefault(matrix, name, version) {
    if (matrix[name]?.includes(version)) return version;
    return matrix[name]?.[0] || '';
}

function EmptyRun() {
    return (
        <div className="flex min-h-[420px] flex-col items-center justify-center rounded-2xl border border-dashed border-[#ded8c9] bg-[#fcfbf8] px-8 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#f8edcb] text-[#8d6815]"><Bot size={26} /></div>
            <h3 className="mt-5 text-[16px] font-semibold text-[#34312b]">{t('AgentLoop 等待启动')}</h3>
            <p className="mt-2 max-w-[430px] text-[12.5px] leading-6 text-gray-400">{t('输入剧本并选定文本、图片和视频模型。启动后将自动提取人物、生成角色设定、规划分镜并逐镜生成视频。')}</p>
            <div className="mt-6 flex flex-wrap justify-center gap-2">
                {['剧本分析', '人物生成', '分镜生成', '视频片段'].map((label, index) => (
                    <span key={label} className="flex items-center gap-1.5 rounded-full border border-[#ebe5d6] bg-white px-3 py-1.5 text-[11px] text-[#81765c]"><span className="font-semibold text-[#bb8b22]">0{index + 1}</span>{t(label)}</span>
                ))}
            </div>
        </div>
    );
}

export default function AgentStudio() {
    const textModels = useMemo(() => getAgentTextModels(), []);
    const [script, setScript] = useState('');
    const [textModel, setTextModel] = useState(textModels[0]?.id || 'hy3');
    const [imageModel, setImageModel] = useState(VOD_DEFAULT_IMAGE_MODEL_NAME);
    const [imageVersion, setImageVersion] = useState(modelDefault(VOD_IMAGE_MODEL_MATRIX, VOD_DEFAULT_IMAGE_MODEL_NAME, VOD_DEFAULT_IMAGE_MODEL_VERSION));
    const [videoModel, setVideoModel] = useState(VOD_DEFAULT_VIDEO_MODEL_NAME);
    const [videoVersion, setVideoVersion] = useState(modelDefault(VOD_VIDEO_MODEL_MATRIX, VOD_DEFAULT_VIDEO_MODEL_NAME, VOD_DEFAULT_VIDEO_MODEL_VERSION));
    const [aspectRatio, setAspectRatio] = useState('16:9');
    const [resolution, setResolution] = useState('1080P');
    const [duration, setDuration] = useState('5s');
    const [audioGeneration, setAudioGeneration] = useState(true);
    const [maxShots, setMaxShots] = useState(4);
    const [run, setRun] = useState(null);
    const [error, setError] = useState('');
    const runningRef = useRef(false);
    const abortRef = useRef(null);

    const isRunning = run?.status === 'running';
    const completedSteps = useMemo(() => {
        const stageIndex = PIPELINE_STEPS.findIndex((item) => item.id === run?.currentStage);
        if (run?.status === 'completed' || run?.status === 'completed_with_errors') return PIPELINE_STEPS.length;
        return Math.max(0, stageIndex);
    }, [run]);

    const startAgent = async () => {
        const value = script.trim();
        if (!value) {
            setError('请先输入剧本内容');
            return;
        }
        setError('');
        setRun(null);
        runningRef.current = true;
        abortRef.current = new AbortController();
        try {
            await runScriptAgentLoop({
                script: value,
                textModel,
                imageModel,
                imageModelVersion: imageVersion,
                videoModel,
                videoModelVersion: videoVersion,
                aspectRatio,
                resolution,
                duration,
                audioGeneration,
                maxShots,
                signal: abortRef.current.signal,
                shouldContinue: () => runningRef.current,
                onUpdate: setRun,
            });
        } catch (nextError) {
            setError(nextError?.message || 'AgentLoop 运行失败');
        } finally {
            runningRef.current = false;
            abortRef.current = null;
        }
    };

    const stopAgent = () => {
        runningRef.current = false;
        abortRef.current?.abort();
    };

    const resetAgent = () => {
        if (isRunning) return;
        setRun(null);
        setError('');
    };

    return (
        <div className="min-h-full bg-white px-5 py-6 sm:px-8 lg:px-10">
            <section className="mx-auto max-w-[1320px]">
                <header className="flex flex-wrap items-end justify-between gap-4">
                    <div>
                        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#b48b30]"><Bot size={14} /> AgentLoop</div>
                        <h1 className="mt-2 text-[26px] font-semibold tracking-[-0.03em] text-[#26241f]">{t('智能 Agent 制片工作室')}</h1>
                        <p className="mt-2 text-[12.5px] text-gray-400">{t('从剧本到角色、分镜与视频片段的自动化生产流程')}</p>
                    </div>
                    {run && !isRunning && (
                        <button type="button" onClick={resetAgent} className="flex h-9 items-center gap-2 rounded-lg border border-[#e7e2d7] px-3 text-[12px] text-gray-500 hover:bg-[#faf8f3]"><RotateCcw size={14} />{t('新建任务')}</button>
                    )}
                </header>

                <div className="mt-7 grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
                    <aside className="space-y-4">
                        <div className="rounded-2xl border border-[#ebe6da] bg-[#fbfaf7] p-4 shadow-[0_8px_24px_rgba(50,43,24,0.04)]">
                            <div className="flex items-center justify-between">
                                <h2 className="text-[13px] font-semibold text-[#34312b]">{t('1. 输入剧本')}</h2>
                                <span className="text-[10.5px] text-gray-400">{script.length} 字</span>
                            </div>
                            <textarea
                                value={script}
                                disabled={isRunning}
                                onChange={(event) => setScript(event.target.value)}
                                placeholder={t('粘贴故事梗概、短剧脚本或广告脚本。建议写清场景、人物、动作和对白...')}
                                className="mt-3 min-h-[220px] w-full resize-y rounded-xl border border-[#e8e3d7] bg-white p-3.5 text-[13px] leading-6 text-[#34312b] outline-none placeholder:text-gray-300 focus:border-[#d5ad4b] focus:ring-2 focus:ring-[#f6e9c4] disabled:bg-[#f6f5f2]"
                            />
                        </div>

                        <div className="rounded-2xl border border-[#ebe6da] bg-[#fbfaf7] p-4 shadow-[0_8px_24px_rgba(50,43,24,0.04)]">
                            <h2 className="text-[13px] font-semibold text-[#34312b]">{t('2. 选择模型')}</h2>
                            <p className="mt-1 text-[10.5px] leading-5 text-gray-400">{t('模型在任务启动后锁定，保证同一批次视觉一致。')}</p>
                            <div className="mt-4 space-y-3">
                                <label className="block">
                                    <span className="mb-1.5 block text-[11px] font-medium text-[#736c5d]">{t('文本分析与分镜')}</span>
                                    <div className="relative"><select value={textModel} disabled={isRunning} onChange={(event) => setTextModel(event.target.value)} className={`${selectClass} appearance-none pr-9`}>{textModels.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}</select><ChevronDown size={14} className="pointer-events-none absolute right-3 top-3 text-gray-400" /></div>
                                </label>
                                <div>
                                    <span className="mb-1.5 block text-[11px] font-medium text-[#736c5d]">{t('人物与分镜图片')}</span>
                                    <div className="grid grid-cols-2 gap-2">
                                        <select value={imageModel} disabled={isRunning} onChange={(event) => { const name = event.target.value; setImageModel(name); setImageVersion(VOD_IMAGE_MODEL_MATRIX[name]?.[0] || ''); }} className={selectClass}>{Object.keys(VOD_IMAGE_MODEL_MATRIX).map((name) => <option key={name}>{name}</option>)}</select>
                                        <select value={imageVersion} disabled={isRunning} onChange={(event) => setImageVersion(event.target.value)} className={selectClass}>{(VOD_IMAGE_MODEL_MATRIX[imageModel] || []).map((version) => <option key={version}>{version}</option>)}</select>
                                    </div>
                                </div>
                                <div>
                                    <span className="mb-1.5 block text-[11px] font-medium text-[#736c5d]">{t('视频片段')}</span>
                                    <div className="grid grid-cols-2 gap-2">
                                        <select value={videoModel} disabled={isRunning} onChange={(event) => { const name = event.target.value; setVideoModel(name); setVideoVersion(VOD_VIDEO_MODEL_MATRIX[name]?.[0] || ''); }} className={selectClass}>{Object.keys(VOD_VIDEO_MODEL_MATRIX).map((name) => <option key={name}>{name}</option>)}</select>
                                        <select value={videoVersion} disabled={isRunning} onChange={(event) => setVideoVersion(event.target.value)} className={selectClass}>{(VOD_VIDEO_MODEL_MATRIX[videoModel] || []).map((version) => <option key={version}>{version}</option>)}</select>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="rounded-2xl border border-[#ebe6da] bg-[#fbfaf7] p-4 shadow-[0_8px_24px_rgba(50,43,24,0.04)]">
                            <h2 className="text-[13px] font-semibold text-[#34312b]">{t('3. 输出设置')}</h2>
                            <div className="mt-4 grid grid-cols-2 gap-3">
                                <label><span className="mb-1.5 block text-[11px] text-[#736c5d]">{t('镜头数量')}</span><select value={maxShots} disabled={isRunning} onChange={(event) => setMaxShots(Number(event.target.value))} className={selectClass}>{[2, 3, 4, 5, 6, 8].map((count) => <option key={count} value={count}>{count} 个镜头</option>)}</select></label>
                                <label><span className="mb-1.5 block text-[11px] text-[#736c5d]">{t('画面比例')}</span><select value={aspectRatio} disabled={isRunning} onChange={(event) => setAspectRatio(event.target.value)} className={selectClass}>{VOD_VIDEO_RATIOS.map((ratio) => <option key={ratio}>{ratio}</option>)}</select></label>
                                <label><span className="mb-1.5 block text-[11px] text-[#736c5d]">{t('清晰度')}</span><select value={resolution} disabled={isRunning} onChange={(event) => setResolution(event.target.value)} className={selectClass}>{RESOLUTIONS.map((value) => <option key={value}>{value}</option>)}</select></label>
                                <label><span className="mb-1.5 block text-[11px] text-[#736c5d]">{t('单镜时长')}</span><select value={duration} disabled={isRunning} onChange={(event) => setDuration(event.target.value)} className={selectClass}>{DURATIONS.map((value) => <option key={value}>{value}</option>)}</select></label>
                            </div>
                            <button type="button" disabled={isRunning} onClick={() => setAudioGeneration((value) => !value)} className={`mt-3 flex w-full items-center justify-between rounded-lg border px-3 py-2.5 text-[12px] transition ${audioGeneration ? 'border-[#ead394] bg-[#fff6dc] text-[#755611]' : 'border-[#e6e2da] bg-white text-gray-500'}`}>
                                <span className="flex items-center gap-2">{audioGeneration ? <Volume2 size={15} /> : <VolumeX size={15} />}{t('音画同步')}</span>
                                <span className="text-[10.5px]">{audioGeneration ? t('开启') : t('关闭')}</span>
                            </button>

                            {error && <div className="mt-3 rounded-lg border border-[#efcf9d] bg-[#fff8e9] px-3 py-2 text-[11px] leading-5 text-[#93671e]">{error}</div>}
                            {isRunning ? (
                                <button type="button" onClick={stopAgent} className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-[#e4b9ad] bg-[#fff4f1] text-[13px] font-semibold text-[#9a4934] transition hover:bg-[#ffebe5]"><Square size={13} className="fill-current" />{t('停止 AgentLoop')}</button>
                            ) : (
                                <button type="button" onClick={startAgent} className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#1f2329] text-[13px] font-semibold text-white shadow-[0_8px_18px_rgba(31,35,41,0.15)] transition hover:bg-black focus:outline-none focus:ring-2 focus:ring-[#e5b43e] focus:ring-offset-2"><Play size={14} className="fill-current" />{t('启动智能 Agent')}</button>
                            )}
                            <p className="mt-2 text-center text-[10px] leading-4 text-gray-300">{t('将按人物数与镜头数调用图片和视频生成服务')}</p>
                        </div>
                    </aside>

                    <main className="min-w-0">
                        {!run ? <EmptyRun /> : (
                            <div className="space-y-5">
                                <section className="rounded-2xl border border-[#ebe6da] bg-white p-5 shadow-[0_8px_24px_rgba(50,43,24,0.04)]">
                                    <div className="flex flex-wrap items-center justify-between gap-3">
                                        <div>
                                            <div className="flex items-center gap-2 text-[13px] font-semibold text-[#34312b]">{isRunning && <Loader2 size={15} className="animate-spin text-[#b48218]" />}{t(STAGE_LABELS[run.currentStage] || '正在运行')}</div>
                                            <div className="mt-1 text-[10.5px] text-gray-400">{run.errors.length ? t(`已有 ${run.errors.length} 个步骤需要关注`) : t('各阶段按顺序自动执行')}</div>
                                        </div>
                                        <span className="text-[18px] font-semibold tabular-nums text-[#9a7118]">{run.progress}%</span>
                                    </div>
                                    <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-[#efede7]"><div className="h-full rounded-full bg-gradient-to-r from-[#d9a728] to-[#f1cf72] transition-all duration-500" style={{ width: `${run.progress}%` }} /></div>
                                    <div className="mt-5 grid grid-cols-5 gap-1.5">
                                        {PIPELINE_STEPS.map((step, index) => {
                                            const active = run.currentStage === step.id;
                                            const done = index < completedSteps || run.status === 'completed' || run.status === 'completed_with_errors';
                                            const Icon = step.icon;
                                            return <div key={step.id} className={`rounded-lg border px-2 py-2 text-center ${active ? 'border-[#e1bf66] bg-[#fff5d8] text-[#74530e]' : done ? 'border-[#e3e0d7] bg-[#f8f7f3] text-[#686359]' : 'border-[#eeeae2] text-gray-300'}`}><div className="mx-auto flex h-5 items-center justify-center">{done ? <Check size={14} /> : active ? <Loader2 size={14} className="animate-spin" /> : <Icon size={14} />}</div><div className="mt-1 truncate text-[9.5px]">{t(step.label)}</div></div>;
                                        })}
                                    </div>
                                </section>

                                {run.characters.length > 0 && (
                                    <section>
                                        <div className="mb-3 flex items-center justify-between"><h2 className="text-[14px] font-semibold text-[#34312b]">{t('人物设定')}</h2><span className="text-[10.5px] text-gray-400">{run.characters.length} 个角色</span></div>
                                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                                            {run.characters.map((character) => (
                                                <article key={character.id} className="overflow-hidden rounded-xl border border-[#ebe6da] bg-[#fbfaf7]">
                                                    <div className="aspect-[4/3] bg-[#f1efe9]">{character.imageUrl ? <img src={character.imageUrl} alt={character.name} className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center">{character.status === 'running' ? <Loader2 size={20} className="animate-spin text-[#b78820]" /> : <UserRound size={24} className="text-gray-300" />}</div>}</div>
                                                    <div className="p-3"><div className="flex items-center justify-between gap-2"><h3 className="truncate text-[12.5px] font-semibold text-[#35322c]">{character.name}</h3><span className={`h-2 w-2 rounded-full ${character.status === 'completed' ? 'bg-emerald-400' : character.status === 'failed' ? 'bg-red-400' : 'bg-amber-300'}`} /></div><p className="mt-1 line-clamp-3 text-[10.5px] leading-4 text-gray-400">{character.description}</p>{character.error && <p className="mt-2 text-[10px] text-red-500">{character.error}</p>}</div>
                                                </article>
                                            ))}
                                        </div>
                                    </section>
                                )}

                                {run.shots.length > 0 && (
                                    <section>
                                        <div className="mb-3 flex items-center justify-between"><h2 className="text-[14px] font-semibold text-[#34312b]">{t('分镜与视频片段')}</h2><span className="text-[10.5px] text-gray-400">{run.shots.filter((shot) => shot.videoUrl).length} / {run.shots.length} 已完成</span></div>
                                        <div className="space-y-3">
                                            {run.shots.map((shot) => (
                                                <article key={shot.id} className="grid overflow-hidden rounded-xl border border-[#ebe6da] bg-[#fbfaf7] md:grid-cols-[220px_minmax(0,1fr)]">
                                                    <div className="aspect-video bg-[#efede7] md:aspect-auto md:min-h-[145px]">{shot.videoUrl ? <video src={shot.videoUrl} controls playsInline className="h-full w-full bg-black object-contain" /> : shot.imageUrl ? <div className="relative h-full"><img src={shot.imageUrl} alt={shot.title} className="h-full w-full object-cover" />{shot.status === 'video_running' && <div className="absolute inset-0 flex items-center justify-center bg-black/35"><Loader2 size={22} className="animate-spin text-white" /></div>}</div> : <div className="flex h-full items-center justify-center">{shot.status.includes('running') ? <Loader2 size={20} className="animate-spin text-[#b78820]" /> : <Film size={24} className="text-gray-300" />}</div>}</div>
                                                    <div className="flex min-w-0 flex-col p-4"><div className="flex items-start justify-between gap-3"><div><span className="text-[9.5px] font-semibold uppercase tracking-[0.12em] text-[#b2872c]">SHOT {String(shot.index).padStart(2, '0')}</span><h3 className="mt-1 text-[13px] font-semibold text-[#34312b]">{shot.title}</h3></div><span className="flex shrink-0 items-center gap-1 rounded-full bg-white px-2 py-1 text-[9.5px] text-gray-400"><Circle size={6} className={shot.videoUrl ? 'fill-emerald-400 text-emerald-400' : shot.error ? 'fill-red-400 text-red-400' : 'fill-amber-300 text-amber-300'} />{shot.videoUrl ? t('视频完成') : shot.imageUrl ? t('分镜完成') : t('等待生成')}</span></div><p className="mt-2 line-clamp-3 text-[11px] leading-5 text-gray-500">{shot.scene}</p><div className="mt-auto flex flex-wrap gap-1.5 pt-3">{shot.characters.map((name) => <span key={name} className="rounded-md bg-[#f0ece1] px-2 py-1 text-[9.5px] text-[#766b51]">{name}</span>)}{shot.camera && <span className="rounded-md bg-white px-2 py-1 text-[9.5px] text-gray-400 ring-1 ring-[#e8e4dc]">{shot.camera}</span>}</div>{shot.error && <p className="mt-2 text-[10px] text-red-500">{shot.error}</p>}</div>
                                                </article>
                                            ))}
                                        </div>
                                    </section>
                                )}
                            </div>
                        )}
                    </main>
                </div>
            </section>
        </div>
    );
}
