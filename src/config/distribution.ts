/** Build-time distribution controls. This value is replaced by Vite at build time. */
export const distribution = ((typeof import.meta !== 'undefined' && import.meta.env?.VITE_DISTRIBUTION) ?? process.env.VITE_DISTRIBUTION ?? 'public') as string;
export const isInternalDesktopDistribution = distribution === 'internal-desktop';
export const isPublicDistribution = !isInternalDesktopDistribution;
