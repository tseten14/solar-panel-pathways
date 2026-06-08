const PAGE_SIZE = 2000;

export interface ArcGISFeature<T> {
  attributes: T;
  geometry?: {
    x?: number;
    y?: number;
    rings?: number[][][];
  };
}

interface ArcGISQueryResponse<T> {
  features: ArcGISFeature<T>[];
  exceededTransferLimit?: boolean;
  error?: { message?: string };
}

export async function queryArcGISFeatures<T extends Record<string, unknown>>(
  baseUrl: string,
  params: Record<string, string>,
): Promise<ArcGISFeature<T>[]> {
  const all: ArcGISFeature<T>[] = [];
  let offset = 0;

  for (;;) {
    const search = new URLSearchParams({
      f: "json",
      ...params,
      resultRecordCount: String(PAGE_SIZE),
      resultOffset: String(offset),
    });

    const res = await fetch(`${baseUrl}?${search}`);
    if (!res.ok) {
      throw new Error(`ArcGIS request failed (${res.status})`);
    }

    const data = (await res.json()) as ArcGISQueryResponse<T>;
    if (data.error?.message) {
      throw new Error(data.error.message);
    }

    all.push(...(data.features ?? []));

    if (!data.exceededTransferLimit || (data.features?.length ?? 0) < PAGE_SIZE) {
      break;
    }
    offset += PAGE_SIZE;
  }

  return all;
}

export async function queryArcGISCount(baseUrl: string, where: string): Promise<number> {
  const search = new URLSearchParams({
    where,
    returnCountOnly: "true",
    f: "json",
  });
  const res = await fetch(`${baseUrl}?${search}`);
  if (!res.ok) throw new Error(`ArcGIS count failed (${res.status})`);
  const data = (await res.json()) as { count?: number; error?: { message?: string } };
  if (data.error?.message) throw new Error(data.error.message);
  return data.count ?? 0;
}
