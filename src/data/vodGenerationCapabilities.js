import { getVodVideoModelCapability } from '../vodAdapter';
import { getVodImageModelCapability } from './vodImageModelCapabilities';

export function getVodGenerationCapability(type, modelName, modelVersion) {
    return type === 'video'
        ? getVodVideoModelCapability(modelName, modelVersion)
        : getVodImageModelCapability(modelName, modelVersion);
}

const keepSupportedValue = (options, currentValue, fallbackValue) => {
    const values = Array.isArray(options) ? options : [];
    const findMatch = (candidate) => values.find(
        (value) => String(value).toLowerCase() === String(candidate || '').toLowerCase(),
    );
    return findMatch(currentValue) || findMatch(fallbackValue) || values[0] || '';
};

export function reconcileVodGenerationSettings(type, modelName, modelVersion, current = {}) {
    const capability = getVodGenerationCapability(type, modelName, modelVersion);
    const ratio = keepSupportedValue(
        capability.ratios,
        current.ratio,
        capability.defaultRatio,
    );
    const resolution = keepSupportedValue(
        capability.resolutions,
        current.resolution,
        capability.defaultResolution,
    );

    if (type !== 'video') {
        return { ratio, resolution };
    }

    return {
        ratio,
        resolution,
        duration: keepSupportedValue(capability.durations, current.duration, capability.defaultDuration),
    };
}

export function buildVodGenerationRequestSettings(type, modelName, modelVersion, current = {}) {
    const normalized = reconcileVodGenerationSettings(type, modelName, modelVersion, current);
    const extraConfig = {};
    if (normalized.resolution && normalized.resolution !== 'Auto') {
        extraConfig.Resolution = normalized.resolution;
    }
    if (type === 'video') {
        const duration = Number.parseInt(normalized.duration, 10);
        if (Number.isFinite(duration) && duration > 0) extraConfig.Duration = duration;
    }
    return {
        ...normalized,
        aspectRatio: normalized.ratio && normalized.ratio !== 'Auto' ? normalized.ratio : undefined,
        extraConfig,
    };
}
