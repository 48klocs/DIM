import { t } from 'app/i18next-t';
import { characterOrderSelector } from 'app/settings/character-sort';
import { RootState, ThunkDispatchProp } from 'app/store/types';
import { emptyArray } from 'app/utils/empty';
import { itemCanBeEquippedBy } from 'app/utils/item-utils';
import { DestinyClass } from 'bungie-api-ts/destiny2';
import clsx from 'clsx';
import { BucketHashes } from 'data/d2/generated-enums';
import emptyEngram from 'destiny-icons/general/empty-engram.svg';
import _ from 'lodash';
import React, { useCallback } from 'react';
import { connect, useDispatch } from 'react-redux';
import { showItemPicker } from '../item-picker/item-picker';
import { itemSortOrderSelector } from '../settings/item-sort';
import { sortItems } from '../shell/filters';
import { addIcon, AppIcon, globeIcon, hunterIcon, titanIcon, warlockIcon } from '../shell/icons';
import { InventoryBucket } from './inventory-buckets';
import { DimItem } from './item-types';
import { moveItemTo } from './move-item';
import { isPhonePortraitSelector, sortedStoresSelector } from './selectors';
import { DimStore } from './store-types';
import './StoreBucket.scss';
import StoreBucketDropTarget from './StoreBucketDropTarget';
import StoreInventoryItem from './StoreInventoryItem';
import { findItemsByBucket } from './stores-helpers';

// Props provided from parents
interface ProvidedProps {
  store: DimStore;
  bucket: InventoryBucket;
}

// Props from Redux via mapStateToProps
interface StoreProps {
  items: DimItem[];
  itemSortOrder: string[];
  allStores: DimStore[];
  characterOrder: string;
  isPhonePortrait: boolean;
}

function mapStateToProps(state: RootState, props: ProvidedProps): StoreProps {
  const { store, bucket } = props;

  return {
    itemSortOrder: itemSortOrderSelector(state),
    // We only need this property when this is a vault armor bucket
    allStores: store.isVault && bucket.inArmor ? sortedStoresSelector(state) : emptyArray(),
    characterOrder: characterOrderSelector(state),
    isPhonePortrait: isPhonePortraitSelector(state),
    items: findItemsByBucket(store, bucket.hash),
  };
}

type Props = ProvidedProps & StoreProps;

export const classIcons = {
  [DestinyClass.Unknown]: globeIcon,
  [DestinyClass.Hunter]: hunterIcon,
  [DestinyClass.Warlock]: warlockIcon,
  [DestinyClass.Titan]: titanIcon,
};

/**
 * A single bucket of items (for a single store).
 */
function StoreBucket({
  items,
  itemSortOrder,
  bucket,
  store,
  allStores,
  characterOrder,
  isPhonePortrait,
}: Props) {
  const dispatch = useDispatch<ThunkDispatchProp['dispatch']>();

  const pickEquipItem = useCallback(async () => {
    try {
      const { item } = await showItemPicker({
        filterItems: (item: DimItem) =>
          item.bucket.hash === bucket.hash && itemCanBeEquippedBy(item, store),
        prompt: t('MovePopup.PullItem', {
          bucket: bucket.name,
          store: store.name,
        }),
      });

      dispatch(moveItemTo(item, store));
    } catch (e) {}
  }, [bucket.hash, bucket.name, dispatch, store]);

  // The vault divides armor by class
  if (store.isVault && bucket.inArmor) {
    const itemsByClass = _.groupBy(items, (item) => item.classType);
    const classTypeOrder = _.sortBy(Object.keys(itemsByClass), (classType) => {
      const classTypeNum = parseInt(classType, 10);
      const index = allStores.findIndex((s) => s.classType === classTypeNum);
      return index === -1 ? 999 : characterOrder === 'mostRecentReverse' ? -index : index;
    });

    return (
      <StoreBucketDropTarget equip={false} bucket={bucket} store={store} dispatch={dispatch}>
        {classTypeOrder.map((classType) => (
          <React.Fragment key={classType}>
            <AppIcon icon={classIcons[classType]} className="armor-class-icon" />
            {sortItems(itemsByClass[classType], itemSortOrder).map((item) => (
              <StoreInventoryItem key={item.index} item={item} isPhonePortrait={isPhonePortrait} />
            ))}
          </React.Fragment>
        ))}
      </StoreBucketDropTarget>
    );
  }

  const equippedItem = items.find((i) => i.equipped);
  const unequippedItems = sortItems(
    items.filter((i) => !i.equipped),
    itemSortOrder
  );

  return (
    <>
      {equippedItem && (
        <StoreBucketDropTarget equip={true} bucket={bucket} store={store} dispatch={dispatch}>
          <div className="equipped-item">
            <StoreInventoryItem
              key={equippedItem.index}
              item={equippedItem}
              isPhonePortrait={isPhonePortrait}
            />
          </div>
          {bucket.hasTransferDestination && (
            <a
              onClick={pickEquipItem}
              className="pull-item-button"
              title={t('MovePopup.PullItem', {
                bucket: bucket.name,
                store: store.name,
              })}
            >
              <AppIcon icon={addIcon} />
            </a>
          )}
        </StoreBucketDropTarget>
      )}
      <StoreBucketDropTarget
        equip={false}
        bucket={bucket}
        store={store}
        className={clsx({ 'not-equippable': !store.isVault && !equippedItem })}
        dispatch={dispatch}
      >
        {unequippedItems.map((item) => (
          <StoreInventoryItem key={item.index} item={item} isPhonePortrait={isPhonePortrait} />
        ))}
        {store.destinyVersion === 2 &&
        bucket.hash === BucketHashes.Engrams && // Engrams. D1 uses this same bucket hash for "Missions"
          _.times(bucket.capacity - unequippedItems.length, (index) => (
            <img src={emptyEngram} className="empty-engram" aria-hidden="true" key={index} />
          ))}
      </StoreBucketDropTarget>
    </>
  );
}

export default connect<StoreProps>(mapStateToProps)(StoreBucket);
