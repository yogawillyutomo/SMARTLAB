import { useMemo } from 'react';
import {
  ASSET_QR_QUIET_ZONE,
  ASSET_QR_SIZE,
  assetQrSvgPath,
  createAssetQrMatrix,
} from '@/lib/assetQrMatrix';

export function AssetQrCode({ publicId, className, showBpMark = true }: {
  publicId: string;
  className?: string;
  showBpMark?: boolean;
}) {
  const rendered = useMemo(() => {
    try {
      return { path: assetQrSvgPath(createAssetQrMatrix(publicId)), error: '' };
    } catch (error) {
      return {
        path: '',
        error: error instanceof Error ? error.message : 'QR Asset tidak dapat dirender.',
      };
    }
  }, [publicId]);

  if (rendered.error) {
    return (
      <div
        role="img"
        aria-label="Asset QR tidak tersedia"
        title={rendered.error}
        className={`flex aspect-square items-center justify-center rounded bg-white p-2 text-center text-[10px] font-semibold text-black ${className ?? ''}`}
      >
        QR belum dikonfigurasi
      </div>
    );
  }

  const total = ASSET_QR_SIZE + ASSET_QR_QUIET_ZONE * 2;
  const markSize = 5;
  const markStart = ASSET_QR_QUIET_ZONE + (ASSET_QR_SIZE - markSize) / 2;

  return (
    <svg
      role="img"
      aria-label="Asset QR"
      className={className}
      viewBox={`0 0 ${total} ${total}`}
      xmlns="http://www.w3.org/2000/svg"
      shapeRendering="crispEdges"
    >
      <rect width={total} height={total} fill="#fff" />
      <path d={rendered.path} fill="#000" transform={`translate(${ASSET_QR_QUIET_ZONE} ${ASSET_QR_QUIET_ZONE})`} />
      {showBpMark && (
        <g aria-hidden="true">
          <rect x={markStart} y={markStart} width={markSize} height={markSize} rx="0.5" fill="#fff" />
          <text
            x={total / 2}
            y={total / 2 + 0.8}
            textAnchor="middle"
            fontSize="2.4"
            fontWeight="800"
            fontFamily="Arial, sans-serif"
            fill="#000"
          >
            BP
          </text>
        </g>
      )}
    </svg>
  );
}
