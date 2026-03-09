import React from 'react';
import type { ResourceDetail } from '../graphReducer';

interface DetailDrawerProps {
  detail: ResourceDetail;
  onClose: () => void;
  onNavigate: (uri: string) => void;
}

function localName(uri: string): string {
  const hashIdx = uri.lastIndexOf('#');
  if (hashIdx >= 0) { return uri.substring(hashIdx + 1); }
  const slashIdx = uri.lastIndexOf('/');
  if (slashIdx >= 0) { return uri.substring(slashIdx + 1); }
  return uri;
}

export function DetailDrawer({ detail, onClose, onNavigate }: DetailDrawerProps) {
  return (
    <div className="detail-drawer">
      <div className="detail-header">
        <strong>{detail.label}</strong>
        <button className="close-btn" onClick={onClose} title="Close">&times;</button>
      </div>

      <div className="detail-uri" title={detail.uri}>
        {detail.uri}
      </div>

      {detail.types.length > 0 && (
        <div className="detail-section">
          <div className="detail-section-title">Types</div>
          {detail.types.map((t, i) => (
            <div key={i} className="detail-type">{localName(t)}</div>
          ))}
        </div>
      )}

      <div className="detail-section">
        <div className="detail-section-title">
          Properties ({detail.properties.length})
        </div>
        {detail.properties.map((prop, i) => (
          <div key={i} className="detail-property">
            <span className="prop-name">{prop.predicateLabel}</span>
            {prop.valueType === 'uri' ? (
              <a
                className="prop-value prop-uri"
                onClick={() => onNavigate(prop.value)}
                title={prop.value}
              >
                {localName(prop.value)}
              </a>
            ) : (
              <span className="prop-value" title={prop.value}>
                {prop.value}
                {prop.language && <span className="prop-lang">@{prop.language}</span>}
              </span>
            )}
          </div>
        ))}
      </div>

      <div className="detail-section">
        <div className="detail-section-title">Connections</div>
        <div className="detail-connections">
          <span>{detail.outgoingCount} outgoing</span>
          <span>{detail.incomingCount} incoming</span>
        </div>
      </div>
    </div>
  );
}
