/**
 * Драйвер KV-хранилища. Основной — Telegram CloudStorage (синхронизация между
 * устройствами, переживает очистку кеша). Если он недоступен (клиент старше
 * Bot API 6.9 или страница открыта вне Telegram) — падаем в localStorage
 * с тем же интерфейсом, а UI показывает баннер.
 *
 * Проверки `isAvailable()` мало: она отвечает по версии клиента, а сам вызов
 * всё равно может бросить (например, в webview, который не отвечает на
 * custom-методы). Поэтому первый же отказ CloudStorage переключает драйвер
 * на localStorage до конца сессии — приложение не должно превращаться
 * в пустой экран из-за хранилища.
 */

import { cloudStorage } from '@telegram-apps/sdk-react';

export type StorageKind = 'cloud' | 'local';

export interface StorageDriver {
  kind: StorageKind;
  getItems(keys: string[]): Promise<Record<string, string>>;
  setItem(key: string, value: string): Promise<void>;
  deleteItems(keys: string[]): Promise<void>;
  getKeys(): Promise<string[]>;
}

/** За один getItems просим не слишком много ключей — запрос идёт через клиент. */
const READ_BATCH = 20;

/**
 * Таймаут на любой запрос к CloudStorage.
 *
 * Обязателен: часть клиентов Telegram просто не отвечает на custom-методы,
 * и без таймаута промис висит вечно — приложение застревает на сплэше.
 * Лучше молча уйти на localStorage, чем не открыться совсем.
 */
const REQUEST_TIMEOUT = 5_000;
const options = { timeout: REQUEST_TIMEOUT };

const cloudDriver: StorageDriver = {
  kind: 'cloud',
  async getItems(keys) {
    if (keys.length === 0) return {};
    const result: Record<string, string> = {};
    for (let i = 0; i < keys.length; i += READ_BATCH) {
      const batch = keys.slice(i, i + READ_BATCH);
      Object.assign(result, await cloudStorage.getItem(batch, options));
    }
    return result;
  },
  async setItem(key, value) {
    await cloudStorage.setItem(key, value, options);
  },
  async deleteItems(keys) {
    if (keys.length === 0) return;
    await cloudStorage.deleteItem(keys, options);
  },
  async getKeys() {
    return cloudStorage.getKeys(options);
  },
};

const LOCAL_PREFIX = 'kc:';

const localDriver: StorageDriver = {
  kind: 'local',
  async getItems(keys) {
    const result: Record<string, string> = {};
    for (const key of keys) {
      result[key] = localStorage.getItem(LOCAL_PREFIX + key) ?? '';
    }
    return result;
  },
  async setItem(key, value) {
    localStorage.setItem(LOCAL_PREFIX + key, value);
  },
  async deleteItems(keys) {
    for (const key of keys) localStorage.removeItem(LOCAL_PREFIX + key);
  },
  async getKeys() {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key?.startsWith(LOCAL_PREFIX)) keys.push(key.slice(LOCAL_PREFIX.length));
    }
    return keys;
  },
};

let driver: StorageDriver | null = null;
let degraded = false;

/** Подписчики на «CloudStorage отвалился» — store перерисовывает баннер. */
const degradeListeners = new Set<() => void>();

export function onStorageDegraded(listener: () => void): () => void {
  degradeListeners.add(listener);
  return () => degradeListeners.delete(listener);
}

/**
 * Переводит приложение на localStorage после отказа CloudStorage.
 * Уже записанные в облако данные при этом не теряются — они просто
 * перестают быть видны до следующего успешного запуска.
 */
function degradeToLocal(error: unknown): StorageDriver {
  if (!degraded) {
    degraded = true;
    console.warn('[storage] CloudStorage недоступен, переходим на localStorage', error);
    driver = localDriver;
    for (const listener of degradeListeners) listener();
  }
  return localDriver;
}

/**
 * Оборачивает облачный драйвер: любой отказ переключает на localStorage
 * и повторяет операцию уже локально.
 */
const resilientCloudDriver: StorageDriver = {
  kind: 'cloud',
  async getItems(keys) {
    try {
      return await cloudDriver.getItems(keys);
    } catch (error) {
      return degradeToLocal(error).getItems(keys);
    }
  },
  async setItem(key, value) {
    try {
      return await cloudDriver.setItem(key, value);
    } catch (error) {
      return degradeToLocal(error).setItem(key, value);
    }
  },
  async deleteItems(keys) {
    try {
      return await cloudDriver.deleteItems(keys);
    } catch (error) {
      return degradeToLocal(error).deleteItems(keys);
    }
  },
  async getKeys() {
    try {
      return await cloudDriver.getKeys();
    } catch (error) {
      return degradeToLocal(error).getKeys();
    }
  },
};

/**
 * `isAvailable()` учитывает и версию Bot API, и то, что SDK вообще
 * проинициализирован в среде Telegram — но это лишь предварительный отбор,
 * окончательный вердикт выносит первый реальный вызов.
 */
export function createDriver(): StorageDriver {
  if (driver) return driver;
  const cloudUsable = (() => {
    try {
      return cloudStorage.getItem.isAvailable() && cloudStorage.setItem.isAvailable();
    } catch {
      return false;
    }
  })();
  driver = cloudUsable ? resilientCloudDriver : localDriver;
  return driver;
}

/** Текущий режим хранилища — для баннера в UI. */
export function storageKind(): StorageKind {
  return createDriver().kind;
}

/** Только для тестов и сброса состояния между сессиями. */
export function resetDriver(): void {
  driver = null;
  degraded = false;
}
