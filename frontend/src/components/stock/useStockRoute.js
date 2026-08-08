import { useCallback, useEffect, useRef, useState } from 'react';

// The open stock lives in the query string rather than in React state, so the
// browser Back button closes the page and a reload reopens it. localStorage is
// deliberately not used to decide whether the page is open: restoring it over a
// clean URL would make Back reopen the page it had just closed.

function fromLocation() {
  const params = new URLSearchParams(window.location.search);
  const symbol = params.get('stock');
  if (!symbol) return null;
  return {
    symbol,
    country: params.get('country') || 'IND',
    portfolioId: params.get('portfolio') || null,
  };
}

function searchWith(stock) {
  const params = new URLSearchParams(window.location.search);
  if (stock) {
    params.set('stock', stock.symbol);
    params.set('country', stock.country || 'IND');
    if (stock.portfolioId) params.set('portfolio', stock.portfolioId);
    else params.delete('portfolio');
  } else {
    params.delete('stock');
    params.delete('country');
    params.delete('portfolio');
  }
  const query = params.toString();
  return `${window.location.pathname}${query ? `?${query}` : ''}`;
}

export default function useStockRoute() {
  const [stock, setStock] = useState(fromLocation);
  // Whether this app pushed the entry currently showing a stock — decides
  // between going back and rewriting the URL when the page is closed.
  const pushed = useRef(false);

  useEffect(() => {
    const onPop = () => {
      const next = fromLocation();
      if (!next) pushed.current = false;
      setStock(next);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const open = useCallback((symbol, country, portfolioId = null) => {
    if (!symbol) return;
    const next = { symbol, country: country || 'IND', portfolioId };
    window.history.pushState({ stock: next }, '', searchWith(next));
    pushed.current = true;
    setStock(next);
    window.scrollTo(0, 0);
  }, []);

  const close = useCallback(() => {
    if (pushed.current) {
      // Let the browser pop the entry so Back and this button agree.
      window.history.back();
      return;
    }
    // Opened by a pasted or reloaded URL — there is nothing of ours to go back
    // to, so the entry is rewritten instead of leaving the app.
    window.history.replaceState({}, '', searchWith(null));
    setStock(null);
  }, []);

  return { stock, open, close };
}
