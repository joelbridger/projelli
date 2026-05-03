/**
 * MobileSettings — kept as a thin re-export so existing imports
 * (SettingsModal, placeholder tests) continue to work after Stream D1
 * shipped the real implementation in `MobileSettingsPage`.
 */

export { MobileSettingsPage as MobileSettings } from '@/components/settings/MobileSettingsPage';
