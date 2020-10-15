import { defaultSettings, Settings as DimApiSettings } from '@destinyitemmanager/dim-api-types';
import { defaultLanguage } from 'app/i18n';

export interface Settings extends DimApiSettings {
  /** Selected columns for the Vault Organizer */
  readonly organizerColumnsGhost: string[];
  readonly loMinPower: number;
  readonly loMinStatTotal: number;
  compareBaseStats: boolean;
  /** Item popup sidecar collapsed just shows icon and no character locations */
  sidecarCollapsed: boolean;
}

export const initialSettingsState: Settings = {
  ...defaultSettings,
  language: defaultLanguage(),
  customTotalStatsByClass: {},
  loMinPower: 750,
  loMinStatTotal: 55,
  organizerColumnsGhost: ['icon', 'name', 'locked', 'tag', 'ghost', 'perks', 'notes'],
  compareBaseStats: false,
  sidecarCollapsed: false,
};
