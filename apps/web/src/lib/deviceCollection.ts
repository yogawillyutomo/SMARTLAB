import { sortDevices } from '@/lib/devicePresentation';
import {
  DEVICE_LIFECYCLE_STATUSES,
  DEVICE_TYPES,
  DeviceContractError,
  type DeviceGateway,
  type DeviceLifecycleStatus,
  type DeviceListFilters,
  type DevicePage,
  type DeviceType,
} from '@/services/deviceApi';

export interface DeviceFilterValues {
  search: string;
  deviceType: '' | DeviceType;
  lifecycleStatus: '' | DeviceLifecycleStatus;
  homeLaboratoryId: string;
}

function filtersFromSearchParams(searchParams: URLSearchParams): DeviceListFilters {
  const filters: DeviceListFilters = { perPage: 25 };
  const page = Number(searchParams.get('page') ?? '1');
  filters.page = Number.isSafeInteger(page) && page > 0 ? page : 1;
  const homeLaboratoryId = searchParams.get('homeLaboratoryId');
  const deviceType = searchParams.get('deviceType');
  const lifecycleStatus = searchParams.get('lifecycleStatus');
  const search = searchParams.get('search')?.trim();
  if (homeLaboratoryId) filters.homeLaboratoryId = homeLaboratoryId;
  if (deviceType && (DEVICE_TYPES as readonly string[]).includes(deviceType)) filters.deviceType = deviceType as DeviceType;
  if (lifecycleStatus && (DEVICE_LIFECYCLE_STATUSES as readonly string[]).includes(lifecycleStatus)) filters.lifecycleStatus = lifecycleStatus as DeviceLifecycleStatus;
  if (search) filters.search = search.slice(0, 100);
  return filters;
}

export function deviceFilterValuesFromSearchParams(searchParams: URLSearchParams): DeviceFilterValues {
  const filters = filtersFromSearchParams(searchParams);
  return {
    search: filters.search ?? '',
    deviceType: filters.deviceType ?? '',
    lifecycleStatus: filters.lifecycleStatus ?? '',
    homeLaboratoryId: filters.homeLaboratoryId ?? '',
  };
}

export function deviceListSearchParams(filters: DeviceFilterValues, page = 1): URLSearchParams {
  const parameters = new URLSearchParams();
  if (page > 1) parameters.set('page', String(page));
  if (filters.search.trim()) parameters.set('search', filters.search.trim());
  if (filters.deviceType) parameters.set('deviceType', filters.deviceType);
  if (filters.lifecycleStatus) parameters.set('lifecycleStatus', filters.lifecycleStatus);
  if (filters.homeLaboratoryId) parameters.set('homeLaboratoryId', filters.homeLaboratoryId);
  return parameters;
}

export type DeviceCollectionLoadResult =
  | { status: 'ready'; page: DevicePage }
  | { status: 'redirect'; searchParams: URLSearchParams };

export async function loadDeviceCollectionForSearchParams(
  gateway: Pick<DeviceGateway, 'list'>,
  searchParams: URLSearchParams,
): Promise<DeviceCollectionLoadResult> {
  const requestedFilters = filtersFromSearchParams(searchParams);
  const page = await gateway.list(requestedFilters);
  const requestedPage = requestedFilters.page ?? 1;

  if (requestedPage > page.meta.lastPage) {
    return {
      status: 'redirect',
      searchParams: deviceListSearchParams(deviceFilterValuesFromSearchParams(searchParams), page.meta.lastPage),
    };
  }
  if (page.meta.page > page.meta.lastPage) {
    throw new DeviceContractError('Metadata halaman Device tidak konsisten.');
  }
  return { status: 'ready', page: { ...page, data: sortDevices(page.data) } };
}

export async function runDeviceListMutation<TResult, TRefresh>(
  mutation: () => Promise<TResult>,
  refreshCollection: () => Promise<TRefresh>,
): Promise<{ result: TResult; refresh: TRefresh }> {
  const result = await mutation();
  const refresh = await refreshCollection();
  return { result, refresh };
}
