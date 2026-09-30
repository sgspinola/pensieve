import type { ItemWithCreator } from "@/services/items/items";

/**
 * `ItemWithCreator` as it travels to the client: timestamps become ISO
 * strings (Date instances aren't guaranteed serializable across the
 * server/client boundary), everything else is unchanged.
 */
export type SerializedItem = Omit<ItemWithCreator, "createdAt" | "updatedAt"> & {
  createdAt: string;
  updatedAt: string;
};

export function serializeItem(item: ItemWithCreator): SerializedItem {
  return {
    ...item,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}
