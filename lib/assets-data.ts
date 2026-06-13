export interface Asset {
  id: string
  filename: string
  contentType: string
  sizeBytes: number
  url: string
  createdAt: string
  referenceCount: number
}

export interface AssetUsage {
  usedBytes: number
  quotaBytes: number
  assetCount: number
}

export interface AssetList {
  items: Asset[]
  usage: AssetUsage
}

export interface StoredAsset {
  id: string
  filename: string
  contentType: string
  sizeBytes: number
  storagePath: string
  createdAt: string
}
