import { useCallback, useEffect, useRef, useState } from 'react';

// The open stock lives in the query string rather than in React state, so the
// browser Back button closes it and a reload reopens it. localStorage is
// deliberately not used to decide whether it is open: restoring it over a
// clean URL would make Back reopen what it had just closed.
//
// `view` is part of that same entry. Clicking a holding opens the chart in a
// pop-up over the portfolio; "Full details" pushes a second entry for the
// deep-dive page. Back therefore walks full page -> pop-up -> portfolio, which
// is the order they were opened in.

function fromLocation() {
  const params = new URLSearchParams(window.location.search);
  const symbol = params.get('stock');
  if (!symbol) return null;
  return {
    symbol,
    country: params.get('country') || 'IND',
    portfolioId: params.get('portfolio') || null,
    view: params.get('view') === 'full' ? 'full' : 'chart',
  };
}

function searchWith(stock) {
  const params = new URLSearchParams(window.location.search);
  if (stock) {
    params.set('stock', stock.symbol);
    params.set('country', stock.country || 'IND');
    if (stock.portfolioId) params.set('portfolio', stock.portfolioId);
    else params.delete('portfolio');
    // The pop-up is the default, so only the deep-dive needs saying.
    if (stock.view === 'full') params.set('view', 'full');
    else params.delete('view');
  } else {
    params.delete('stock');
    params.delete('country');
    params.delete('portfolio');
    params.delete('view');
  }
  const query = params.toString();
  return `${window.location.pathname}${query ? `?${query}` : ''}`;
}

export default function useStockRoute() {
  const [stock, setStock] = useState(fromLocation);
  // Whether this app pushed the entry currently showing a stock — decides
  // between going back and rewriting the URL when it is closed.
  const pushed = useRef(false);
  // Read by `expand`, which must not derive the next state inside a setState
  // updater: StrictMode runs those twice and would push two history entries.
  const current = useRef(stock);
  useEffect(() => { current.current = stock; }, [stock]);

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
    const next = { symbol, country: country || 'IND', portfolioId, view: 'chart' };
    window.history.pushState({ stock: next }, '', searchWith(next));
    pushed.current = true;
    setStock(next);
    // No scroll to top: the pop-up sits over the page you were reading.
  }, []);

  const expand = useCallback(() => {
    const showing = current.current;
    if (!showing || showing.view === 'full') return;
    const next = { ...showing, view: 'full' };
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

  return { stock, open, expand, close };
}
