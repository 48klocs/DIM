import { settingsSelector } from 'app/dim-api/selectors';
import { itemPop } from 'app/dim-ui/scroll';
import { getWeaponArchetype } from 'app/dim-ui/WeaponArchetype';
import { t } from 'app/i18next-t';
import ElementIcon from 'app/inventory/ElementIcon';
import { allItemsSelector } from 'app/inventory/selectors';
import { powerCapPlugSetHash } from 'app/search/d2-known-values';
import { makeDupeID } from 'app/search/search-filters/dupes';
import { setSetting } from 'app/settings/actions';
import Checkbox from 'app/settings/Checkbox';
import { RootState } from 'app/store/types';
import {
  getItemSpecialtyModSlotDisplayName,
  getSpecialtySocketMetadata,
} from 'app/utils/item-utils';
import { DestinyDisplayPropertiesDefinition } from 'bungie-api-ts/destiny2';
import clsx from 'clsx';
import { ItemCategoryHashes, StatHashes } from 'data/d2/generated-enums';
import React from 'react';
import { connect } from 'react-redux';
import { RouteComponentProps, withRouter } from 'react-router';
import { createSelector } from 'reselect';
import { D2ManifestDefinitions } from '../destiny2/d2-definitions';
import Sheet from '../dim-ui/Sheet';
import { DimItem, DimStat } from '../inventory/item-types';
import { showNotification } from '../notifications/notifications';
import { chainComparator, compareBy, reverseComparator } from '../utils/comparators';
import { Subscriptions } from '../utils/rx-utils';
import './compare.scss';
import { CompareService } from './compare.service';
import CompareItem from './CompareItem';

interface StoreProps {
  allItems: DimItem[];
  defs?: D2ManifestDefinitions;
  compareBaseStats: boolean;
}

const mapDispatchToProps = {
  setSetting,
};
type DispatchProps = typeof mapDispatchToProps;

type Props = StoreProps & RouteComponentProps & DispatchProps;

function mapStateToProps(state: RootState): StoreProps {
  return {
    allItems: allItemsSelector(state),
    defs: state.manifest.d2Manifest,
    compareBaseStats: settingsSelector(state).compareBaseStats,
  };
}

// TODO: There's far too much state here.
// TODO: maybe have a holder/state component and a connected display component
interface State {
  show: boolean;
  comparisonItems: DimItem[];
  highlight?: string | number;
  sortedHash?: string | number;
  sortBetterFirst: boolean;
  comparisonSets: { buttonLabel: React.ReactNode; items: DimItem[] }[];
}

export interface StatInfo {
  id: string | number;
  displayProperties: DestinyDisplayPropertiesDefinition;
  min: number;
  max: number;
  enabled: boolean;
  lowerBetter: boolean;
  getStat: StatGetter;
}

/** a DimStat with, at minimum, a statHash */
export type MinimalStat = Partial<DimStat> & Pick<DimStat, 'statHash'>;
type StatGetter = (item: DimItem) => undefined | MinimalStat;

class Compare extends React.Component<Props, State> {
  state: State = {
    comparisonItems: [],
    comparisonSets: [],
    show: false,
    sortBetterFirst: true,
  };
  private subscriptions = new Subscriptions();

  // Memoize computing the list of stats
  private getAllStatsSelector = createSelector(
    (state: State) => state.comparisonItems,
    (_state: State, props: Props) => props.compareBaseStats,
    getAllStats
  );

  componentDidMount() {
    this.subscriptions.add(
      CompareService.compareItems$.subscribe((args) => {
        this.setState({ show: true });
        CompareService.dialogOpen = true;

        this.add(args);
      })
    );
  }

  componentDidUpdate(prevProps: Props) {
    if (prevProps.location.pathname !== this.props.location.pathname) {
      this.cancel();
    }
  }

  componentWillUnmount() {
    this.subscriptions.unsubscribe();
    CompareService.dialogOpen = false;
  }

  render() {
    const { compareBaseStats, setSetting } = this.props;
    const {
      show,
      comparisonItems: unsortedComparisonItems,
      sortedHash,
      highlight,
      comparisonSets,
    } = this.state;

    if (!show || unsortedComparisonItems.length === 0) {
      CompareService.dialogOpen = false;
      return null;
    }

    const onChange: React.ChangeEventHandler<HTMLInputElement> = (e) => {
      setSetting(e.target.name as any, e.target.checked);
    };

    const comparisonItems = !sortedHash
      ? unsortedComparisonItems
      : Array.from(unsortedComparisonItems).sort(
          reverseComparator(
            chainComparator(
              compareBy((item: DimItem) => {
                const stat =
                  item.primStat && sortedHash === item.primStat.statHash
                    ? (item.primStat as MinimalStat)
                    : sortedHash === 'EnergyCapacity'
                    ? {
                        value: item.energy?.energyCapacity || 0,
                        base: undefined,
                      }
                    : sortedHash === 'PowerCap'
                    ? {
                        value: item.powerCap || 99999999,
                        base: undefined,
                      }
                    : (item.stats || []).find((s) => s.statHash === sortedHash);

                if (!stat) {
                  return -1;
                }

                const shouldReverse =
                  isDimStat(stat) && stat.smallerIsBetter
                    ? this.state.sortBetterFirst
                    : !this.state.sortBetterFirst;

                const statValue = (compareBaseStats ? stat.base ?? stat.value : stat.value) || 0;
                return shouldReverse ? -statValue : statValue;
              }),
              compareBy((i) => i.index),
              compareBy((i) => i.name)
            )
          )
        );

    const stats = this.getAllStatsSelector(this.state, this.props);

    return (
      <Sheet
        onClose={this.cancel}
        header={
          <div className="compare-options">
            <Checkbox
              label={t('Compare.CompareBaseStats')}
              name="compareBaseStats"
              value={compareBaseStats}
              onChange={onChange}
            />
            {comparisonSets.map(({ buttonLabel, items }, index) => (
              <button
                type="button"
                key={index}
                className="dim-button"
                onClick={(e) => this.compareSimilar(e, items)}
              >
                {buttonLabel} {`(${items.length})`}
              </button>
            ))}
          </div>
        }
      >
        <div id="loadout-drawer" className="compare">
          <div className="compare-bucket" onMouseLeave={() => this.setHighlight(undefined)}>
            <div className="compare-item fixed-left">
              <div className="spacer" />
              {stats.map((stat) => (
                <div
                  key={stat.id}
                  className={clsx('compare-stat-label', {
                    highlight: stat.id === highlight,
                    sorted: stat.id === sortedHash,
                  })}
                  onMouseOver={() => this.setHighlight(stat.id)}
                  onClick={() => this.sort(stat.id)}
                >
                  {stat.displayProperties.name}
                </div>
              ))}
            </div>
            <div className="compare-items" onTouchStart={this.stopTouches}>
              {comparisonItems.map((item) => (
                <CompareItem
                  item={item}
                  key={item.id}
                  stats={stats}
                  itemClick={itemPop}
                  remove={this.remove}
                  setHighlight={this.setHighlight}
                  highlight={highlight}
                  compareBaseStats={compareBaseStats}
                />
              ))}
            </div>
          </div>
        </div>
      </Sheet>
    );
  }

  // prevent touches from bubbling which blocks scrolling
  private stopTouches = (e: React.TouchEvent) => {
    e.preventDefault();
    e.stopPropagation();
    return false;
  };

  private setHighlight = (highlight?: string | number) => {
    this.setState({ highlight });
  };

  private cancel = () => {
    this.setState({
      show: false,
      comparisonItems: [],
      highlight: undefined,
      sortedHash: undefined,
    });
    CompareService.dialogOpen = false;
  };

  private compareSimilar = (e: React.MouseEvent, comparisonSetItems: DimItem[]) => {
    e.preventDefault();
    this.setState({
      comparisonItems: comparisonSetItems,
    });
  };

  private sort = (sortedHash?: string | number) => {
    this.setState((prevState) => ({
      sortedHash,
      sortBetterFirst: prevState.sortedHash === sortedHash ? !prevState.sortBetterFirst : true,
    }));
  };
  private add = ({
    additionalItems,
    showSomeDupes,
  }: {
    additionalItems: DimItem[];
    showSomeDupes: boolean;
  }) => {
    // use the first item and assume all others are of the same 'type'
    const exampleItem = additionalItems[0];
    if (!exampleItem.comparable) {
      return;
    }

    const { comparisonItems } = this.state;
    if (comparisonItems.length && exampleItem.typeName !== comparisonItems[0].typeName) {
      showNotification({
        type: 'warning',
        title: exampleItem.name,
        body:
          comparisonItems[0].classType && exampleItem.classType !== comparisonItems[0].classType
            ? t('Compare.Error.Class', { class: comparisonItems[0].classTypeNameLocalized })
            : t('Compare.Error.Archetype', { type: comparisonItems[0].typeName }),
      });
      return;
    }

    // if there are existing comparisonItems, we're adding this one in
    if (comparisonItems.length) {
      // but not if it's already being compared
      if (comparisonItems.some((i) => i.id === exampleItem.id)) {
        return;
      }

      this.setState({ comparisonItems: [...comparisonItems, ...additionalItems] });
    }

    // else,this is a fresh comparison sheet spawn, so let's generate comparisonSets
    else {
      const allItems = this.props.allItems;
      // comparisonSets is an array so that it has order, filled with {label, setOfItems} objects
      const comparisonSets = exampleItem.bucket.inArmor
        ? this.findSimilarArmors(allItems, additionalItems)
        : exampleItem.bucket.inWeapons
        ? this.findSimilarWeapons(allItems, additionalItems)
        : [];

      // if this was spawned from an item, and not from a search,
      // DIM tries to be helpful by including a starter comparison of dupes
      if (additionalItems.length === 1 && showSomeDupes) {
        const comparisonItems = comparisonSets[0]?.items ?? additionalItems;
        this.setState({
          comparisonSets,
          comparisonItems,
        });
      }
      // otherwise, compare only the items we were asked to compare
      else {
        this.setState({ comparisonSets, comparisonItems: [...additionalItems] });
      }
    }
  };

  private remove = (item: DimItem) => {
    const { comparisonItems } = this.state;

    if (comparisonItems.length <= 1) {
      this.cancel();
    } else {
      this.setState({ comparisonItems: comparisonItems.filter((c) => c.id !== item.id) });
    }
  };

  private findSimilarArmors = (
    allArmors: DimItem[],
    comparisonItems = this.state.comparisonItems
  ) => {
    const exampleItem = comparisonItems[0];
    const exampleItemElementIcon = (
      <ElementIcon key={exampleItem.id} element={exampleItem.element} />
    );
    const exampleItemModSlot = getSpecialtySocketMetadata(exampleItem);
    const specialtyModSlotName =
      (this.props.defs && getItemSpecialtyModSlotDisplayName(exampleItem, this.props.defs)) ?? '';

    // helper functions for filtering items
    const matchesExample = (key: keyof DimItem) => (item: DimItem) =>
      item[key] === exampleItem[key];
    const matchingModSlot = (item: DimItem) =>
      exampleItemModSlot === getSpecialtySocketMetadata(item);
    const hasEnergy = (item: DimItem) => Boolean(item.energy);

    // minimum filter: make sure it's all armor, and can go in the same slot on the same class
    allArmors = allArmors
      .filter((i) => i.bucket.inArmor)
      .filter(matchesExample('typeName'))
      .filter(matchesExample('classType'));

    let comparisonSets = [
      // same slot on the same class
      {
        buttonLabel: exampleItem.typeName,
        items: allArmors,
      },

      // above but also has to be armor 2.0
      {
        buttonLabel: [t('Compare.Armor2'), exampleItem.typeName].join(' + '),
        items: hasEnergy(exampleItem) ? allArmors.filter(hasEnergy) : [],
      },

      // above but also the same seasonal mod slot, if it has one
      {
        buttonLabel: [specialtyModSlotName].join(' + '),
        items:
          hasEnergy(exampleItem) && exampleItemModSlot
            ? allArmors.filter(hasEnergy).filter(matchingModSlot)
            : [],
      },

      // armor 2.0 and needs to match energy capacity element
      {
        buttonLabel: [exampleItemElementIcon, exampleItem.typeName],
        items: hasEnergy(exampleItem)
          ? allArmors.filter(hasEnergy).filter(matchesExample('element'))
          : [],
      },
      // above but also the same seasonal mod slot, if it has one
      {
        buttonLabel: [exampleItemElementIcon, specialtyModSlotName],
        items:
          hasEnergy(exampleItem) && exampleItemModSlot
            ? allArmors.filter(hasEnergy).filter(matchingModSlot).filter(matchesExample('element'))
            : [],
      },

      // basically stuff with the same name & categories
      {
        buttonLabel: exampleItem.name,
        items: allArmors.filter((i) => makeDupeID(i) === makeDupeID(exampleItem)),
      },

      // above, but also needs to match energy capacity element
      {
        buttonLabel: [exampleItemElementIcon, exampleItem.name],
        items: hasEnergy(exampleItem)
          ? allArmors
              .filter(hasEnergy)
              .filter(matchesExample('element'))
              .filter((i) => makeDupeID(i) === makeDupeID(exampleItem))
          : [],
      },
    ];

    // here, we dump some buttons if they aren't worth displaying

    comparisonSets = comparisonSets.reverse();
    comparisonSets = comparisonSets.filter((comparisonSet, index) => {
      const nextComparisonSet = comparisonSets[index + 1];
      // always print the final button
      if (!nextComparisonSet) {
        return true;
      }
      // skip empty buttons
      if (!comparisonSet.items.length) {
        return false;
      }
      // skip if the next button has [all of, & only] the exact same items in it
      if (
        comparisonSet.items.length === nextComparisonSet.items.length &&
        comparisonSet.items.every((setItem) =>
          nextComparisonSet.items.some((nextSetItem) => nextSetItem === setItem)
        )
      ) {
        return false;
      }
      return true;
    });

    return comparisonSets;
  };

  private findSimilarWeapons = (
    allWeapons: DimItem[],
    comparisonItems = this.state.comparisonItems
  ) => {
    const exampleItem = comparisonItems[0];
    const exampleItemElementIcon = (
      <ElementIcon key={exampleItem.id} element={exampleItem.element} />
    );

    const matchesExample = (key: keyof DimItem) => (item: DimItem) =>
      item[key] === exampleItem[key];
    // stuff for looking up weapon archetypes
    const getRpm = (i: DimItem) => {
      const itemRpmStat = i.stats?.find(
        (s) =>
          s.statHash ===
          (exampleItem.destinyVersion === 1
            ? exampleItem.stats![0].statHash
            : StatHashes.RoundsPerMinute)
      );
      return itemRpmStat?.value || -99999999;
    };

    const exampleItemRpm = getRpm(exampleItem);
    const intrinsic = getWeaponArchetype(exampleItem);
    const intrinsicName = intrinsic?.displayProperties.name || t('Compare.Archetype');
    const intrinsicHash = intrinsic?.hash;

    // minimum filter: make sure it's all weapons and the same weapon type
    allWeapons = allWeapons
      .filter((i) => i.bucket.inWeapons)
      .filter(matchesExample('typeName'))
      .filter(
        (i) =>
          // specifically for destiny 2 grenade launchers, let's not compare special with heavy.
          // all other weapon types with multiple ammos, are novelty exotic exceptions
          !(exampleItem.destinyVersion === 2) ||
          !(i.destinyVersion === 2) ||
          !exampleItem.itemCategoryHashes.includes(ItemCategoryHashes.GrenadeLaunchers) ||
          exampleItem.ammoType === i.ammoType
      );

    let comparisonSets = [
      // same weapon type
      {
        buttonLabel: exampleItem.typeName,
        items: allWeapons,
      },

      // above, but also same (kinetic/energy/heavy) slot
      {
        buttonLabel: [exampleItem.bucket.name, exampleItem.typeName].join(' + '),
        items: allWeapons.filter((i) => i.bucket.name === exampleItem.bucket.name),
      },

      // same weapon type plus matching intrinsic (rpm+impact..... ish)
      {
        buttonLabel: [intrinsicName, exampleItem.typeName].join(' + '),
        items:
          exampleItem.destinyVersion === 2
            ? allWeapons.filter((i) => getWeaponArchetype(i)?.hash === intrinsicHash)
            : allWeapons.filter((i) => exampleItemRpm === getRpm(i)),
      },

      // same weapon type and also matching element (& usually same-slot because same element)
      {
        buttonLabel: [exampleItemElementIcon, exampleItem.typeName],
        items: allWeapons.filter(matchesExample('element')),
      },

      // exact same weapon, judging by name. might span multiple expansions.
      {
        buttonLabel: exampleItem.name,
        items: allWeapons.filter(matchesExample('name')),
      },
    ];
    comparisonSets = comparisonSets.reverse();
    comparisonSets = comparisonSets.filter((comparisonSet, index) => {
      const nextComparisonSet = comparisonSets[index + 1];
      // always print the final button
      if (!nextComparisonSet) {
        return true;
      }
      // skip empty buttons
      if (!comparisonSet.items.length) {
        return false;
      }
      // skip if the next button has [all of, & only] the exact same items in it
      if (
        comparisonSet.items.length === nextComparisonSet.items.length &&
        comparisonSet.items.every((setItem) =>
          nextComparisonSet.items.some((nextSetItem) => nextSetItem === setItem)
        )
      ) {
        return false;
      }
      return true;
    });

    return comparisonSets;
  };
}

function getAllStats(comparisonItems: DimItem[], compareBaseStats: boolean) {
  const firstComparison = comparisonItems[0];
  compareBaseStats = Boolean(compareBaseStats && firstComparison.bucket.inArmor);
  const stats: StatInfo[] = [];

  if (firstComparison.primStat) {
    stats.push(
      makeFakeStat(
        firstComparison.primStat.statHash,
        firstComparison.primStat.stat.displayProperties,
        (item: DimItem) => item.primStat || undefined
      )
    );
  }
  if (
    firstComparison.destinyVersion === 2 &&
    (firstComparison.bucket.inArmor || firstComparison.bucket.inWeapons)
  ) {
    stats.push(
      makeFakeStat('PowerCap', t('Stats.PowerCap'), (item: DimItem) => ({
        statHash: powerCapPlugSetHash,
        value: item.powerCap ?? undefined,
        base: undefined,
      }))
    );
  }

  if (firstComparison.destinyVersion === 2 && firstComparison.bucket.inArmor) {
    stats.push(
      makeFakeStat(
        'EnergyCapacity',
        t('EnergyMeter.Energy'),
        (item: DimItem) =>
          (item.energy && {
            statHash: item.energy.energyType,
            value: item.energy.energyCapacity,
            base: undefined,
          }) ||
          undefined
      )
    );
  }

  // Todo: map of stat id => stat object
  // add 'em up
  const statsByHash: { [statHash: string]: StatInfo } = {};
  for (const item of comparisonItems) {
    if (item.stats) {
      for (const stat of item.stats) {
        let statInfo = statsByHash[stat.statHash];
        if (!statInfo) {
          statInfo = {
            id: stat.statHash,
            displayProperties: stat.displayProperties,
            min: Number.MAX_SAFE_INTEGER,
            max: 0,
            enabled: false,
            lowerBetter: false,
            getStat(item: DimItem) {
              return item.stats ? item.stats.find((s) => s.statHash === stat.statHash) : undefined;
            },
          };
          statsByHash[stat.statHash] = statInfo;
          stats.push(statInfo);
        }
      }
    }
  }

  for (const stat of stats) {
    for (const item of comparisonItems) {
      const itemStat = stat.getStat(item);
      if (itemStat) {
        stat.min = Math.min(
          stat.min,
          (compareBaseStats ? itemStat.base ?? itemStat.value : itemStat.value) || 0
        );
        stat.max = Math.max(
          stat.max,
          (compareBaseStats ? itemStat.base ?? itemStat.value : itemStat.value) || 0
        );
        stat.enabled = stat.min !== stat.max;
        stat.lowerBetter = isDimStat(itemStat) ? itemStat.smallerIsBetter : false;
      }
    }
  }

  return stats;
}

function isDimStat(stat: DimStat | any): stat is DimStat {
  return Object.prototype.hasOwnProperty.call(stat as DimStat, 'smallerIsBetter');
}

function makeFakeStat(
  id: string | number,
  displayProperties: DestinyDisplayPropertiesDefinition | string,
  getStat: StatGetter,
  lowerBetter = false
) {
  if (typeof displayProperties === 'string') {
    displayProperties = { name: displayProperties } as DestinyDisplayPropertiesDefinition;
  }
  return {
    id,
    displayProperties,
    min: Number.MAX_SAFE_INTEGER,
    max: 0,
    enabled: false,
    lowerBetter,
    getStat,
  };
}

export default withRouter(
  connect<StoreProps, DispatchProps>(mapStateToProps, mapDispatchToProps)(Compare)
);
