import React, { useEffect, useRef, useState } from 'react';

/**
 * TradingViewModal - Displays TradingView Advanced Chart in a modal
 * Handles smooth animations and proper symbol conversion
 */
export default function TradingViewModal({ isOpen, onClose, symbol, instrumentName }) {
  const containerRef = useRef();
  const overlayRef = useRef();
  const [useIframe, setUseIframe] = useState(false);

  useEffect(() => {
    if (!isOpen || !symbol) return;

    console.log('[TradingViewModal] Loading chart for symbol:', symbol);

    // Clear previous chart if any
    if (containerRef.current && !useIframe) {
      containerRef.current.innerHTML = '';
    }

    if (useIframe) {
      // Use iframe method as fallback
      return;
    }

    // Create and inject TradingView script
    const script = document.createElement('script');
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
    script.type = 'text/javascript';
    script.async = true;
    
    const config = {
      autosize: true,
      symbol: symbol,
      interval: '15',
      timezone: 'Asia/Kolkata',
      theme: 'light',
      style: '1',
      locale: 'en',
      enable_publishing: false,
      allow_symbol_change: true,
      calendar: false,
      hide_side_toolbar: false,
      hide_top_toolbar: false,
      hide_legend: false,
      hide_volume: false,
      save_image: true,
      container_id: 'tradingview_chart',
      backgroundColor: '#ffffff',
      gridColor: 'rgba(46, 46, 46, 0.06)',
      studies: ['STD;EMA'],
      show_popup_button: false,
      popup_width: '1000',
      popup_height: '650',
      watchlist: [],
      withdateranges: false,
      compareSymbols: [],
      hotlist: false,
      details: false
    };
    
    console.log('[TradingViewModal] Config:', config);
    script.innerHTML = JSON.stringify(config);

    if (containerRef.current) {
      containerRef.current.appendChild(script);
    }

    // Handle ESC key
    const handleEsc = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEsc);

    return () => {
      document.removeEventListener('keydown', handleEsc);
    };
  }, [isOpen, symbol, onClose, useIframe]);

  // Handle click outside to close
  const handleOverlayClick = (e) => {
    if (e.target === overlayRef.current) {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 backdrop-blur-sm transition-opacity duration-300 ease-out"
      style={{ animation: 'fadeIn 0.3s ease-out' }}
    >
      <div
        className="relative bg-white rounded-2xl shadow-2xl w-[95vw] h-[90vh] max-w-[1600px] overflow-hidden"
        style={{ animation: 'slideUp 0.3s ease-out' }}
      >
        {/* Header */}
        <div className="absolute top-0 left-0 right-0 z-10 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div>
              <h2 className="text-xl font-bold text-gray-900">{instrumentName || 'Chart'}</h2>
              <p className="text-sm text-gray-500">TradingView • {symbol}</p>
            </div>
            {!useIframe && (
              <button
                onClick={() => setUseIframe(true)}
                className="text-xs px-3 py-1.5 rounded bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors"
                title="Switch to iframe mode if chart doesn't load"
              >
                Try Alternative View
              </button>
            )}
          </div>
          <button
            onClick={onClose}
            className="flex items-center justify-center w-10 h-10 rounded-full hover:bg-gray-100 transition-colors duration-200"
            aria-label="Close"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-6 w-6 text-gray-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* TradingView Chart Container */}
        <div className="pt-20 pb-4 px-4 h-full">
          {useIframe ? (
            <iframe
              src={`https://www.tradingview.com/chart/?symbol=${encodeURIComponent(symbol)}&interval=15&theme=light`}
              style={{ width: '100%', height: '100%', border: 'none', borderRadius: '8px' }}
              title="TradingView Chart"
            />
          ) : (
            <div
              ref={containerRef}
              className="tradingview-widget-container"
              style={{ height: '100%', width: '100%' }}
            >
              <div className="tradingview-widget-container__widget" style={{ height: '100%', width: '100%' }}></div>
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes fadeIn {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }

        @keyframes slideUp {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  );
}
