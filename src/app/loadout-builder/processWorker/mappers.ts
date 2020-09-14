import _ from 'lodash';
import { DimItem, DimSocket, DimSockets } from '../../inventory/item-types';
import {
  getSpecialtySocketMetadata,
  getSpecialtySocketMetadataByPlugCategoryHash,
} from '../../utils/item-utils';
import {
  ArmorSet,
  LockedArmor2Mod,
  LockedArmor2ModMap,
  ModPickerCategories,
  statHashToType,
  StatTypes,
} from '../types';
import { ProcessArmorSet, ProcessItem, ProcessMod, ProcessSocket, ProcessSockets } from './types';

function mapDimSocketToProcessSocket(dimSocket: DimSocket): ProcessSocket {
  return {
    plug: dimSocket.plugged && {
      stats: dimSocket.plugged.stats,
      plugItemHash: dimSocket.plugged.plugDef.hash,
    },
    plugOptions: dimSocket.plugOptions.map((dimPlug) => ({
      stats: dimPlug.stats,
      plugItemHash: dimPlug.plugDef.hash,
    })),
  };
}

export function mapArmor2ModToProcessMod(mod: LockedArmor2Mod): ProcessMod {
  const processMod = {
    hash: mod.mod.hash,
    energy: {
      type: mod.mod.plug.energyCost!.energyType,
      val: mod.mod.plug.energyCost!.energyCost,
    },
    investmentStats: mod.mod.investmentStats,
  };

  if (mod.category === 'seasonal') {
    const metadata = getSpecialtySocketMetadataByPlugCategoryHash(mod.mod.plug.plugCategoryHash);
    return {
      ...processMod,
      season: metadata?.season,
      tag: metadata?.tag,
    };
  }

  return processMod;
}

/**
 * This sums up the total stat contributions across mods passed in. These are then applied
 * to the loadouts after all the items base values have been summed. This mimics how seasonal mods
 * effect stat values in game and allows us to do some preprocessing.
 *
 * For the Mod Picker this can be used for seasonal and general mods. For mods in perk picker this is
 * just for the seasonal mods.
 */
export function getTotalModStatChanges(lockedArmor2Mods: LockedArmor2ModMap) {
  const totals: { [stat in StatTypes]: number } = {
    Mobility: 0,
    Recovery: 0,
    Resilience: 0,
    Intellect: 0,
    Discipline: 0,
    Strength: 0,
  };

  for (const category of Object.values(ModPickerCategories)) {
    for (const mod of lockedArmor2Mods[category]) {
      for (const stat of mod.mod.investmentStats) {
        const statType = statHashToType[stat.statTypeHash];
        if (statType) {
          totals[statType] += stat.value;
        }
      }
    }
  }

  return totals;
}

function mapDimSocketsToProcessSockets(dimSockets: DimSockets): ProcessSockets {
  return {
    sockets: dimSockets.allSockets.map(mapDimSocketToProcessSocket),
    categories: dimSockets.categories.map((category) => ({
      categoryStyle: category.category.categoryStyle,
      sockets: category.sockets.map(mapDimSocketToProcessSocket),
    })),
  };
}

export function mapDimItemToProcessItem(
  dimItem: DimItem,
  modsForSlot: LockedArmor2Mod[]
): ProcessItem {
  const { bucket, id, type, name, equippingLabel, basePower, stats } = dimItem;

  const statMap: { [statHash: number]: number } = {};
  const baseStatMap: { [statHash: number]: number } = {};

  if (stats) {
    for (const { statHash, value, base } of stats) {
      statMap[statHash] = value;
      baseStatMap[statHash] = base;
    }
  }

  const modMetadata = getSpecialtySocketMetadata(dimItem);
  const costInitial =
    dimItem.energy && _.sumBy(modsForSlot, (mod) => mod.mod.plug.energyCost!.energyCost);
  return {
    bucketHash: bucket.hash,
    id,
    type,
    name,
    equippingLabel,
    basePower,
    stats: statMap,
    baseStats: baseStatMap,
    sockets: dimItem.sockets && mapDimSocketsToProcessSockets(dimItem.sockets),
    energy:
      dimItem.energy && costInitial !== null
        ? {
            type: dimItem.energy.energyType,
            valInitial: costInitial, // this is needed to reset energy used after trying to slot mods
            val: costInitial,
          }
        : null,
    season: modMetadata?.season,
    compatibleModSeasons: modMetadata?.compatibleTags,
  };
}

export function hydrateArmorSet(
  processed: ProcessArmorSet,
  itemsById: { [id: string]: DimItem[] }
): ArmorSet {
  const armor: DimItem[][] = [];

  for (const itemId of processed.armor) {
    armor.push(itemsById[itemId]);
  }

  return {
    armor,
    statChoices: processed.statChoices,
    stats: processed.stats,
    maxPower: processed.maxPower,
  };
}
