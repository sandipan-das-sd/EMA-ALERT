import React, { useState, useEffect, useRef, useCallback } from 'react';
import { searchInstruments, addToWatchlist } from '../lib/api.js';

export default function InstrumentSearch({ user, setUser, onInstrumentAdded }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [selectedSegments, setSelectedSegments] = useState(['NSE_EQ', 'BSE_EQ', 'NSE_INDEX', 'BSE_INDEX']);
  const [adding, setAdding] = useState({});
  
  const searchRef = useRef(null);
  const dropdownRef = useRef(null);
  const searchTimeout = useRef(null);

  const segments = [
    { value: 'NSE_EQ', label: 'NSE Equity', color: 'bg-blue-100 text-blue-800' },
    { value: 'NSE_FO', label: 'NSE F&O', color: 'bg-purple-100 text-purple-800' },
    { value: 'NSE_INDEX', label: 'NSE Index', color: 'bg-green-100 text-green-800' },
    { value: 'BSE_EQ', label: 'BSE Equity', color: 'bg-orange-100 text-orange-800' },
    { value: 'BSE_FO', label: 'BSE F&O', color: 'bg-pink-100 text-pink-800' },
    { value: 'BSE_INDEX', label: 'BSE Index', color: 'bg-teal-100 text-teal-800' }
  ];

  const performSearch = useCallback(async (searchQuery) => {
    if (!searchQuery || searchQuery.trim().length < 2) {
      setResults([]);
      return;
    }

    setIsSearching(true);
    try {
      const searchResults = await searchInstruments(searchQuery.trim(), {
        segments: selectedSegments,
        limit: 20
      });
      setResults(searchResults);
    } catch (error) {
      console.error('Search failed:', error);
      setResults([]);
    } finally {
      setIsSearching(false);
    }
  }, [selectedSegments]);

  // Force re-render of results when user watchlist changes
  useEffect(() => {
    // If we have search results and user watchlist changed, trigger a re-render
    if (results.length > 0) {
      // Force component update by setting results to itself
      setResults(prevResults => [...prevResults]);
    }
  }, [user?.watchlist]);

  useEffect(() => {
    if (searchTimeout.current) {
      clearTimeout(searchTimeout.current);
    }

    if (query.length >= 2) {
      searchTimeout.current = setTimeout(() => {
        performSearch(query);
      }, 300);
    } else {
      setResults([]);
    }

    return () => {
      if (searchTimeout.current) {
        clearTimeout(searchTimeout.current);
      }
    };
  }, [query, performSearch]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target) &&
        !searchRef.current?.contains(event.target)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleInputChange = (e) => {
    const value = e.target.value;
    setQuery(value);
    setIsOpen(value.length >= 2);
  };

  const handleSegmentToggle = (segment) => {
    setSelectedSegments(prev => {
      const isSelected = prev.includes(segment);
      if (isSelected) {
        return prev.filter(s => s !== segment);
      } else {
        return [...prev, segment];
      }
    });
  };

  const handleAddToWatchlist = async (instrument) => {
    if (adding[instrument.key]) return;

    setAdding(prev => ({ ...prev, [instrument.key]: true }));
    try {
      const updatedWatchlist = await addToWatchlist(instrument.key);
      if (updatedWatchlist && Array.isArray(updatedWatchlist)) {
        setUser(prevUser => ({ ...prevUser, watchlist: updatedWatchlist }));
        onInstrumentAdded?.(instrument);
        
        // Show brief success feedback
        console.log(`✅ Added ${instrument.tradingSymbol} to watchlist`);
      }
    } catch (error) {
      console.error('Failed to add to watchlist:', error);
    } finally {
      setAdding(prev => ({ ...prev, [instrument.key]: false }));
    }
  };

  const isInWatchlist = (instrumentKey) => {
    const inWatchlist = user?.watchlist?.includes(instrumentKey) || false;
    // Debug log to see if detection is working
    if (results.length > 0) {
      console.log(`[Search] Checking ${instrumentKey}: ${inWatchlist ? 'IN' : 'NOT IN'} watchlist (${user?.watchlist?.length || 0} items)`);
    }
    return inWatchlist;
  };

  const getSegmentInfo = (segment) => {
    return segments.find(s => s.value === segment) || { label: segment, color: 'bg-gray-100 text-gray-800' };
  };

  const formatPrice = (price) => {
    if (typeof price !== 'number') return '—';
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 2
    }).format(price);
  };

  return (
    <div className="relative w-full max-w-2xl">
      {/* Search Input */}
      <div className="relative">
        <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
          <svg className={`h-5 w-5 transition-colors duration-200 ${
            query.length >= 2 ? 'text-blue-500' : 'text-gray-400'
          }`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
        <input
          ref={searchRef}
          type="text"
          value={query}
          onChange={handleInputChange}
          className={`w-full pl-12 pr-12 py-4 border-2 rounded-xl font-medium text-gray-900 placeholder-gray-500 transition-all duration-300 shadow-sm hover:shadow-md focus:shadow-lg ${
            isOpen 
              ? 'border-blue-500 ring-4 ring-blue-100 bg-white' 
              : 'border-gray-200 bg-gray-50 hover:bg-white hover:border-gray-300 focus:border-blue-500 focus:ring-4 focus:ring-blue-100 focus:bg-white'
          }`}
          placeholder="Search stocks, indices, futures & options... (e.g., RELIANCE, NIFTY, TCS)"
          onFocus={() => query.length >= 2 && setIsOpen(true)}
        />
        <div className="absolute inset-y-0 right-0 pr-4 flex items-center">
          {isSearching ? (
            <div className="flex items-center space-x-1">
              <svg className="animate-spin h-5 w-5 text-blue-500" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <span className="text-xs text-blue-600 font-medium">Searching...</span>
            </div>
          ) : query.length >= 2 ? (
            <div className="flex items-center space-x-1">
              <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
              <span className="text-xs text-green-600 font-medium">Ready</span>
            </div>
          ) : (
            <div className="text-xs text-gray-400 font-medium">Type to search</div>
          )}
        </div>
      </div>

      {/* Segment Filters */}
      <div className="mt-4 flex flex-wrap gap-2">
        <div className="text-xs font-semibold text-gray-600 mb-1 w-full">Filter by segments:</div>
        {segments.map(segment => (
          <button
            key={segment.value}
            onClick={() => handleSegmentToggle(segment.value)}
            className={`px-3 py-2 rounded-lg text-xs font-semibold transition-all duration-300 transform hover:scale-105 ${
              selectedSegments.includes(segment.value)
                ? segment.color + ' ring-2 ring-offset-2 ring-blue-300 shadow-md'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200 hover:shadow-sm'
            }`}
          >
            <span className="flex items-center space-x-1">
              <span>{segment.label}</span>
              {selectedSegments.includes(segment.value) && (
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              )}
            </span>
          </button>
        ))}
      </div>

      {/* Search Results Dropdown */}
      {isOpen && (
        <div 
          ref={dropdownRef}
          className="absolute top-full left-0 right-0 mt-2 bg-white border-2 border-gray-100 rounded-xl shadow-2xl z-50 max-h-96 overflow-hidden backdrop-blur-sm animate-in fade-in slide-in-from-top-2 duration-300"
        >
          {isSearching ? (
            <div className="p-6 text-center">
              <div className="flex flex-col items-center space-y-3">
                <div className="relative">
                  <div className="w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin"></div>
                  <div className="absolute inset-0 w-8 h-8 border-4 border-transparent border-r-blue-400 rounded-full animate-spin animation-delay-150"></div>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-600">Searching instruments...</p>
                  <p className="text-xs text-gray-400 mt-1">Looking through {selectedSegments.length} segment{selectedSegments.length !== 1 ? 's' : ''}</p>
                </div>
              </div>
            </div>
          ) : results.length > 0 ? (
            <div className="divide-y divide-gray-50 max-h-96 overflow-y-auto custom-scrollbar">
              <div className="sticky top-0 bg-gradient-to-r from-blue-50 to-indigo-50 px-4 py-2 border-b border-blue-100">
                <p className="text-xs font-semibold text-blue-800">
                  {results.length} result{results.length !== 1 ? 's' : ''} found for "{query}"
                </p>
              </div>
              {results.map((instrument, index) => {
                const segmentInfo = getSegmentInfo(instrument.segment);
                const inWatchlist = isInWatchlist(instrument.key);
                const isAdding = adding[instrument.key];
                
                return (
                  <div 
                    key={instrument.key} 
                    className={`p-4 hover:bg-gradient-to-r hover:from-blue-50 hover:to-indigo-50 transition-all duration-200 transform hover:scale-[1.02] ${
                      index === 0 ? 'animate-in fade-in slide-in-from-left-1 duration-300' : 
                      index === 1 ? 'animate-in fade-in slide-in-from-left-1 duration-300 animation-delay-75' :
                      index === 2 ? 'animate-in fade-in slide-in-from-left-1 duration-300 animation-delay-150' : ''
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <h3 className="text-sm font-bold text-gray-900 truncate">
                                {instrument.tradingSymbol}
                              </h3>
                              <span className={`px-2 py-0.5 rounded-md text-xs font-bold ${segmentInfo.color} shadow-sm`}>
                                {segmentInfo.label}
                              </span>
                            </div>
                            <p className="text-xs text-gray-600 truncate leading-relaxed">
                              {instrument.name}
                            </p>
                            {(instrument.lotSize && instrument.lotSize > 1) || instrument.tickSize ? (
                              <div className="flex items-center gap-2 mt-2">
                                {instrument.lotSize && instrument.lotSize > 1 && (
                                  <span className="text-xs bg-amber-100 text-amber-800 px-2 py-1 rounded-md font-medium">
                                    Lot: {instrument.lotSize}
                                  </span>
                                )}
                                {instrument.tickSize && (
                                  <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded-md font-medium">
                                    Tick: ₹{instrument.tickSize}
                                  </span>
                                )}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </div>
                      <div className="ml-4 flex-shrink-0">
                        {inWatchlist ? (
                          <div className="inline-flex items-center px-4 py-2 rounded-lg bg-gradient-to-r from-green-500 to-emerald-500 text-white shadow-lg">
                            <svg className="w-4 h-4 mr-2" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                            <span className="text-sm font-bold">Added</span>
                          </div>
                        ) : (
                          <button
                            onClick={() => handleAddToWatchlist(instrument)}
                            disabled={isAdding}
                            className="inline-flex items-center px-4 py-2 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-bold shadow-lg hover:from-blue-700 hover:to-indigo-700 focus:ring-4 focus:ring-blue-200 transition-all duration-200 transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
                          >
                            {isAdding ? (
                              <>
                                <svg className="animate-spin w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                                </svg>
                                <span className="text-sm">Adding...</span>
                              </>
                            ) : (
                              <>
                                <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                                </svg>
                                <span className="text-sm">Add to Watchlist</span>
                              </>
                            )}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : query.length >= 2 ? (
            <div className="p-8 text-center">
              <div className="flex flex-col items-center space-y-4">
                <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center">
                  <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9.172 16.172a4 4 0 015.656 0M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-600">No instruments found</p>
                  <p className="text-xs text-gray-400 mt-1">Try different keywords or adjust segment filters</p>
                  <p className="text-xs text-blue-600 mt-2 font-medium">
                    Searching in: {selectedSegments.join(', ')}
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="p-8 text-center">
              <div className="flex flex-col items-center space-y-4">
                <div className="w-16 h-16 bg-gradient-to-br from-blue-100 to-indigo-100 rounded-full flex items-center justify-center">
                  <svg className="w-8 h-8 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-600">Start typing to search</p>
                  <p className="text-xs text-gray-400 mt-1">Search by symbol, company name, or ISIN</p>
                  <div className="mt-3 flex flex-wrap justify-center gap-1">
                    {['RELIANCE', 'NIFTY', 'TCS', 'HDFCBANK'].map(example => (
                      <button
                        key={example}
                        onClick={() => setQuery(example)}
                        className="text-xs bg-blue-100 text-blue-600 px-2 py-1 rounded-md hover:bg-blue-200 transition-colors duration-200 font-medium"
                      >
                        {example}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}