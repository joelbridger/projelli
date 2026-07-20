/**
 * Private operational form endpoints. UI modules import these values instead
 * of reaching into BRAND.urls, so an internal service address cannot become
 * rendered product copy by accident.
 */
import { BRAND } from '@/config/brand';

export const BUG_REPORT_ENDPOINT = BRAND.urls.formsBugReport;
export const AI_SETUP_HELP_ENDPOINT = BRAND.urls.formsAiSetupHelp;
