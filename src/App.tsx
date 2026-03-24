/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { Search, Settings, Play, Terminal, Film, Activity, Link as LinkIcon, ShieldAlert, Cpu, Network, Copy, CheckCircle2, Trash2, Box, Zap, Server } from 'lucide-react';

// --- Type Definitions ---
interface TMDBMovie {
  title: string;
  overview: string;
  release_date: string;
  vote_average: number;
  poster_path: string;
  name?: string; // For TV shows if needed
}

interface StremioAddon {
  name: string;
  url: string;
  version?: string;
  description?: string;
}

interface StremioStream {
  addonName?: string;
  addonUrl?: string;
  name?: string;
  title?: string;
  infoHash?: string;
  url?: string;
  ytId?: string;
  behaviorHints?: any;
}

// Declare global variables for CDN libraries
declare global {
  interface Window {
    Artplayer: any;
    Hls: any;
    WebTorrent: any;
  }
}

export default function App() {
  // --- State ---
  const [tmdbId, setTmdbId] = useState('');
  const [mediaUrl, setMediaUrl] = useState('');
  const [embedLink, setEmbedLink] = useState('');
  const [copied, setCopied] = useState(false);
  const [logsCopied, setLogsCopied] = useState(false);
  
  const [movieData, setMovieData] = useState<TMDBMovie | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [logs, setLogs] = useState<string[]>([
    '[SYS] Inicializando EmbedFlix Core v4.0...',
    '[SYS] Módulo de Gerenciamento de Addons carregado.',
    '[SYS] Aguardando parâmetros de entrada...'
  ]);
  
  // Addon & Stream State
  const [installedAddons, setInstalledAddons] = useState<StremioAddon[]>([]);
  const [newAddonUrl, setNewAddonUrl] = useState('');
  const [availableStreams, setAvailableStreams] = useState<StremioStream[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  // Settings State
  const [tmdbApiKey, setTmdbApiKey] = useState('468925ac3759d7adeb05b540cfd71cb8');
  const [proxies] = useState([
    'https://api.allorigins.win/raw?url=',
    'https://corsproxy.io/?',
    'https://thingproxy.freeboard.io/fetch/'
  ]);
  const [gatewayPrefix, setGatewayPrefix] = useState(proxies[0]);
  const [rdApiKey, setRdApiKey] = useState('');
  const [adApiKey, setAdApiKey] = useState('');
  const [isIframeMode, setIsIframeMode] = useState(false);
  const [iframeUrl, setIframeUrl] = useState('');
  const [currentInfoHash, setCurrentInfoHash] = useState('');

  // Refs
  const playerContainerRef = useRef<HTMLDivElement>(null);
  const artPlayerRef = useRef<any>(null);
  const webTorrentClientRef = useRef<any>(null);
  const terminalContainerRef = useRef<HTMLDivElement>(null);

  // --- Initialization ---
  useEffect(() => {
    // Load Addons and Settings from LocalStorage
    let savedAddons = null;
    let savedRdKey = null;
    let savedAdKey = null;
    try {
      savedAddons = localStorage.getItem('embedflix_addons');
      savedRdKey = localStorage.getItem('embedflix_rd_key');
      savedAdKey = localStorage.getItem('embedflix_ad_key');
    } catch (e) {
      addLog('[ERR] Acesso ao armazenamento local negado.');
    }
    
    if (savedRdKey) setRdApiKey(savedRdKey);
    if (savedAdKey) setAdApiKey(savedAdKey);
    
    let currentAddons: StremioAddon[] = [];
    if (savedAddons) {
      try {
        currentAddons = JSON.parse(savedAddons);
        setInstalledAddons(currentAddons);
        addLog(`[SYS] ${currentAddons.length} addons carregados do armazenamento local.`);
      } catch (e) {
        addLog('[ERR] Falha ao decodificar addons salvos.');
      }
    } else {
      addLog('[SYS] Nenhum addon instalado. Instale um addon Stremio nas configurações.');
    }

    // Check URL Params for Embed Mode
    const params = new URLSearchParams(window.location.search);
    const addonParam = params.get('addon');
    const urlId = params.get('id');

    addLog(`[SYS] Proxy ativo: https://api.allorigins.win/raw?url=`);

    if (urlId) {
      setTmdbId(urlId);
      if (addonParam) {
        const decodedAddon = decodeURIComponent(addonParam);
        addLog(`[SYS] Modo Embed detectado. Addon: ${decodedAddon}`);
        
        // Auto-install if not present
        const isInstalled = currentAddons.some(a => a.url === decodedAddon);
        if (!isInstalled) {
          addLog(`[SYS] Addon da URL não encontrado na biblioteca. Instalando...`);
        }

        setTimeout(() => {
          handleSingleDiscovery(decodedAddon, urlId);
        }, 1500);
      }
    }
  }, []);

  useEffect(() => {
    if (rdApiKey) {
      localStorage.setItem('embedflix_rd_key', rdApiKey);
    }
  }, [rdApiKey]);

  // --- Hybrid Mode: Direct Sources ---
  const findDirectSources = async (id: string) => {
    const parts = id.split(':');
    const imdbId = parts[0];
    const isSeries = parts.length > 1;
    const season = parts[1] || '1';
    const episode = parts[2] || '1';
    
    addLog(`[SYS] P2P lento ou indisponível. Buscando fontes diretas (HTTP) para ${id}...`);
    
    const type = isSeries ? 'tv' : 'movie';
    const suffix = isSeries ? `/${season}/${episode}` : '';
    
    const providers = [
      { name: 'Superflix', url: `https://superflixapi.top/${type}/${imdbId}${suffix}` },
      { name: 'WarezCDN', url: `https://embed.warezcdn.com/${type}/${imdbId}${suffix}` },
    ];

    for (const provider of providers) {
      try {
        const checkUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(provider.url)}`;
        const res = await fetch(checkUrl, { method: 'HEAD' });
        if (res.ok) {
          addLog(`[NET] Fonte direta encontrada: ${provider.name}`);
          return provider.url;
        }
      } catch (e) {
        continue;
      }
    }
    return null;
  };

  const switchToDirectSource = async () => {
    const source = await findDirectSources(tmdbId);
    if (source) {
      setIframeUrl(source);
      setIsIframeMode(true);
      if (webTorrentClientRef.current) {
        webTorrentClientRef.current.destroy();
        webTorrentClientRef.current = null;
      }
      addLog(`[SYS] Alternando para modo Iframe (Fonte Direta).`);
    } else {
      addLog(`[ERR] Nenhuma fonte direta encontrada para este título.`);
    }
  };

  // --- Helpers ---
  const addLog = (msg: string) => {
    setLogs(prev => {
      const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const newLogs = [...prev, `[${time}] ${msg}`];
      return newLogs.slice(-50); // Keep last 50 logs
    });
  };

  const scrollToBottom = () => {
    if (terminalContainerRef.current) {
      terminalContainerRef.current.scrollTo({
        top: terminalContainerRef.current.scrollHeight,
        behavior: 'smooth'
      });
    }
  };

  const copyLogsToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(logs.join('\n'));
      setLogsCopied(true);
      setTimeout(() => setLogsCopied(false), 2000);
    } catch (err) {
      addLog('[ERR] Falha ao copiar logs.');
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [logs]);

  // Resilient Fetch Middleware (Proxy Rotation & Anti-HTML)
  const fetchWithProxy = async (targetUrl: string) => {
    if (!targetUrl || typeof targetUrl !== 'string') {
      throw new Error('URL de destino inválida.');
    }
    const cleanUrl = targetUrl.replace(/^stremio:\/\//, 'https://');
    
    const proxies = [
      (url: string) => url, // Direct attempt first
      (url: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
      (url: string) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
      (url: string) => `https://thingproxy.freeboard.io/fetch/${encodeURIComponent(url)}`,
      (url: string) => `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`
    ];

    let lastError;
    for (const proxyFn of proxies) {
      try {
        const proxiedUrl = proxyFn(cleanUrl);
        const res = await fetch(proxiedUrl, { cache: 'no-store' });
        if (!res.ok) continue;

        const contentType = res.headers.get('content-type') || '';
        
        if (proxiedUrl.includes('allorigins.win/get?url=')) {
          const wrapper = await res.json();
          if (wrapper.contents) {
            try {
              return JSON.parse(wrapper.contents);
            } catch (e) {
              lastError = new Error('Erro de parsing no allorigins (HTML retornado).');
              continue;
            }
          } else {
            lastError = new Error('Resposta allorigins vazia.');
            continue;
          }
        } else {
          // Read as text first to catch "Unexpected token '<'"
          const text = await res.text();
          try {
            return JSON.parse(text);
          } catch (e) {
            lastError = new Error('Resposta não é JSON válido (HTML retornado). Ignorando bloqueio de rede...');
            continue;
          }
        }
      } catch (err) {
        lastError = err;
        continue;
      }
    }
    throw lastError || new Error('Todos os proxies falharam.');
  };

  const applyGateway = (url: string) => {
    if (!url || typeof url !== 'string') return url;
    if (!gatewayPrefix || url.startsWith('magnet:') || url.startsWith('blob:')) {
      return url;
    }
    if (url.includes(gatewayPrefix)) return url;
    return `${gatewayPrefix}${encodeURIComponent(url)}`;
  };

  const copyToClipboard = () => {
    if (!embedLink) return;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(embedLink);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
        addLog(`[SYS] Link de Embed copiado para a área de transferência.`);
      } else {
        addLog('[WRN] Área de transferência não disponível neste ambiente.');
      }
    } catch (err: any) {
      addLog(`[ERR] Falha ao copiar link: ${err.message}`);
    }
  };

  // --- Addon Management ---
  const handleInstallAddon = async () => {
    if (!newAddonUrl) return;
    addLog(`[SYS] Instalando addon: ${newAddonUrl}`);
    try {
      const manifest = await fetchWithProxy(newAddonUrl);
      if (!manifest || (!manifest.id && !manifest.name)) throw new Error('Manifesto inválido');
      
      const newAddon: StremioAddon = { 
        name: manifest.name || 'Addon Desconhecido', 
        url: newAddonUrl,
        version: manifest.version,
        description: manifest.description
      };
      
      const updated = [...installedAddons.filter(a => a.url !== newAddonUrl), newAddon];
      setInstalledAddons(updated);
      try {
        localStorage.setItem('embedflix_addons', JSON.stringify(updated));
      } catch (e) {
        addLog('[WRN] Não foi possível salvar o addon no armazenamento local.');
      }
      setNewAddonUrl('');
      addLog(`[SYS] Addon instalado com sucesso: ${newAddon.name}`);
    } catch (err: any) {
      addLog(`[ERR] Falha ao instalar addon: ${err.message}`);
    }
  };

  const removeAddon = (urlToRemove: string) => {
    const updated = installedAddons.filter(a => a.url !== urlToRemove);
    setInstalledAddons(updated);
    try {
      localStorage.setItem('embedflix_addons', JSON.stringify(updated));
    } catch (e) {
      addLog('[WRN] Não foi possível atualizar o armazenamento local.');
    }
    addLog(`[SYS] Addon removido.`);
  };

  // --- TMDB Integration ---
  const fetchMetadata = async (idToFetch: string = tmdbId) => {
    if (!idToFetch || !tmdbApiKey) return;

    const baseId = idToFetch.split(':')[0]; // Extract tt1234567 from tt1234567:1:1

    addLog(`[NET] Resolvendo metadados para ID: ${baseId}...`);
    try {
      let fetchUrl = `https://api.themoviedb.org/3/movie/${baseId}?api_key=${tmdbApiKey}&language=pt-BR`;
      if (baseId.startsWith('tt')) {
        fetchUrl = `https://api.themoviedb.org/3/find/${baseId}?api_key=${tmdbApiKey}&external_source=imdb_id&language=pt-BR`;
      }

      const response = await fetch(fetchUrl);
      if (!response.ok) throw new Error('Falha na resolução do nó de metadados.');
      const data = await response.json();
      
      let movie = data;
      if (idToFetch.startsWith('tt')) {
        if (data.movie_results && data.movie_results.length > 0) {
          movie = data.movie_results[0];
        } else if (data.tv_results && data.tv_results.length > 0) {
          movie = data.tv_results[0];
        } else {
          throw new Error('Mídia não encontrada via IMDB ID.');
        }
      }

      setMovieData(movie);
      addLog(`[SYS] Metadados sincronizados: ${movie.title || movie.name}`);
    } catch (error: any) {
      addLog(`[ERR] ${error.message}`);
      setMovieData(null);
    }
  };

  // --- Multi-Addon Discovery ---
  const handleMultiDiscovery = async () => {
    if (!tmdbId) {
      addLog('[ERR] ID Universal é obrigatório para busca.');
      return;
    }
    if (installedAddons.length === 0) {
      addLog('[ERR] Nenhum addon instalado. Configure addons primeiro.');
      return;
    }

    setIsSearching(true);
    setAvailableStreams([]);
    setEmbedLink('');
    addLog(`[SYS] Iniciando varredura em ${installedAddons.length} addons para o ID: ${tmdbId}`);
    
    fetchMetadata(tmdbId);

    const allStreams: StremioStream[] = [];

    const promises = installedAddons.map(async (addon) => {
      try {
        if (!addon || typeof addon.url !== 'string') return;
        let baseUrl = addon.url.endsWith('/manifest.json') ? addon.url.replace('/manifest.json', '') : addon.url;
        
        // Detect if it's a series (e.g., tt1234567:1:1)
        const isSeries = tmdbId.includes(':');
        const type = isSeries ? 'series' : 'movie';
        
        const streamEndpoint = `${baseUrl}/stream/${type}/${tmdbId}.json`; 
        
        addLog(`[NET] Consultando: ${addon.name}...`);
        const data = await fetchWithProxy(streamEndpoint);
        
        if (data && data.streams && data.streams.length > 0) {
          const streamsWithMeta = data.streams.map((s: any) => ({
            ...s,
            addonName: addon.name,
            addonUrl: addon.url
          }));
          allStreams.push(...streamsWithMeta);
          addLog(`[NET] ${streamsWithMeta.length} streams encontrados em: ${addon.name}`);
        } else {
          addLog(`[NET] Nenhum stream em: ${addon.name}`);
        }
      } catch (err: any) {
        addLog(`[WRN] Falha ao consultar ${addon.name}: ${err.message}`);
      }
    });

    await Promise.allSettled(promises);
    
    setAvailableStreams(allStreams);
    setIsSearching(false);
    addLog(`[SYS] Varredura concluída. Total de streams: ${allStreams.length}`);

    if (allStreams.length > 0) {
      // --- AUTOMATION: Netflix Mode ---
      addLog(`[SYS] Modo Netflix Ativo: Selecionando melhor stream automaticamente...`);
      
      // 1. Sort streams by quality and seeds
      const sortedStreams = [...allStreams].sort((a, b) => {
        const getScore = (s: StremioStream) => {
          let score = 0;
          const title = (s.title || s.name || '').toLowerCase();
          if (title.includes('4k') || title.includes('2160p')) score += 1000;
          else if (title.includes('1080p')) score += 500;
          else if (title.includes('720p')) score += 200;
          
          // Extract seeds if available (e.g., "👤 100" or "Seeds: 100")
          const seedsMatch = title.match(/(?:👤|seeds:?)\s*(\d+)/i);
          if (seedsMatch) score += parseInt(seedsMatch[1]);
          
          return score;
        };
        return getScore(b) - getScore(a);
      });

      // 2. Try Cache (RD/AD) for top streams if API key exists
      const topStreams = sortedStreams.slice(0, 5);
      for (const stream of topStreams) {
        if (stream.infoHash) {
          if (rdApiKey) {
            addLog(`[RD] Verificando cache para: ${stream.title?.split('\n')[0]}`);
            const rdUrl = await checkRealDebrid(stream.infoHash, rdApiKey);
            if (rdUrl) {
              addLog(`[RD] Stream em cache encontrado! Iniciando reprodução instantânea.`);
              const finalUrl = applyGateway(rdUrl);
              selectStream({ ...stream, url: finalUrl, infoHash: undefined }, tmdbId);
              return;
            }
          }
          if (adApiKey) {
            addLog(`[AD] Verificando cache para: ${stream.title?.split('\n')[0]}`);
            const adUrl = await checkAllDebrid(stream.infoHash, adApiKey);
            if (adUrl) {
              addLog(`[AD] Stream em cache encontrado! Iniciando reprodução instantânea.`);
              const finalUrl = applyGateway(adUrl);
              selectStream({ ...stream, url: finalUrl, infoHash: undefined }, tmdbId);
              return;
            }
          }
        }
      }
      addLog(`[SYS] Nenhum dos melhores streams está em cache. Usando P2P.`);

      // 3. Fallback: Play best P2P stream
      addLog(`[SYS] Iniciando melhor stream P2P disponível.`);
      selectStream(sortedStreams[0], tmdbId);
    } else {
      addLog(`[ERR] Nenhum stream encontrado em nenhum addon.`);
    }
  };

  // --- Single Addon Discovery (For Embed Links) ---
  const handleSingleDiscovery = async (addonUrl: string, id: string) => {
    if (!addonUrl || typeof addonUrl !== 'string') return;
    addLog(`[SYS] Extraindo stream direto do addon: ${addonUrl}`);
    fetchMetadata(id);
    
    try {
      // Ensure addon is in the list for better UX
      // Use functional update to avoid stale state
      setInstalledAddons(prev => {
        const isInstalled = prev.some(a => a.url === addonUrl);
        if (!isInstalled) {
          // We can't await inside setInstalledAddons, so we'll do it outside
          // but we need to know if we should trigger the fetch
          return prev; 
        }
        return prev;
      });

      // Better way: check localStorage directly or just try to fetch manifest and add if missing
      const saved = localStorage.getItem('embedflix_addons');
      const addons: StremioAddon[] = saved ? JSON.parse(saved) : [];
      if (!addons.some(a => a.url === addonUrl)) {
        try {
          const manifest = await fetchWithProxy(addonUrl);
          if (manifest) {
            const newAddon: StremioAddon = { 
              name: manifest.name || 'Addon URL', 
              url: addonUrl,
              version: manifest.version,
              description: manifest.description
            };
            const updated = [...addons, newAddon];
            setInstalledAddons(updated);
            localStorage.setItem('embedflix_addons', JSON.stringify(updated));
            addLog(`[SYS] Addon da URL registrado com sucesso.`);
          }
        } catch (e) {
          addLog(`[WRN] Falha ao registrar addon da URL, mas prosseguindo com a busca.`);
        }
      }

      let baseUrl = addonUrl.endsWith('/manifest.json') ? addonUrl.replace('/manifest.json', '') : addonUrl;
      const isSeries = id.includes(':');
      const type = isSeries ? 'series' : 'movie';
      const streamEndpoint = `${baseUrl}/stream/${type}/${id}.json`;
      
      const data = await fetchWithProxy(streamEndpoint);
      
      if (!data || !data.streams || data.streams.length === 0) {
        throw new Error('Nenhum stream encontrado neste Addon.');
      }

      // --- AUTOMATION: Single Addon Mode ---
      const sortedStreams = [...data.streams].sort((a, b) => {
        const getScore = (s: any) => {
          let score = 0;
          const title = (s.title || s.name || '').toLowerCase();
          if (title.includes('4k') || title.includes('2160p')) score += 1000;
          else if (title.includes('1080p')) score += 500;
          else if (title.includes('720p')) score += 200;
          const seedsMatch = title.match(/(?:👤|seeds:?)\s*(\d+)/i);
          if (seedsMatch) score += parseInt(seedsMatch[1]);
          return score;
        };
        return getScore(b) - getScore(a);
      });

      // Try Cache (RD/AD) for top streams
      const topStreams = sortedStreams.slice(0, 5);
      for (const stream of topStreams) {
        if (stream.infoHash) {
          if (rdApiKey) {
            addLog(`[RD] Verificando cache para: ${stream.title?.split('\n')[0]}`);
            const rdUrl = await checkRealDebrid(stream.infoHash, rdApiKey);
            if (rdUrl) {
              addLog(`[RD] Stream em cache encontrado!`);
              const finalUrl = applyGateway(rdUrl);
              selectStream({ ...stream, url: finalUrl, infoHash: undefined, addonUrl }, id);
              return;
            }
          }
          if (adApiKey) {
            addLog(`[AD] Verificando cache para: ${stream.title?.split('\n')[0]}`);
            const adUrl = await checkAllDebrid(stream.infoHash, adApiKey);
            if (adUrl) {
              addLog(`[AD] Stream em cache encontrado!`);
              const finalUrl = applyGateway(adUrl);
              selectStream({ ...stream, url: finalUrl, infoHash: undefined, addonUrl }, id);
              return;
            }
          }
        }
      }

      const stream: StremioStream = sortedStreams[0];
      stream.addonUrl = addonUrl;
      
      selectStream(stream, id);
    } catch (error: any) {
      addLog(`[ERR] Falha no Embed Automático: ${error.message}`);
    }
  };

  // --- Stream Selection & Playback ---
  const selectStream = (stream: StremioStream, id: string = tmdbId) => {
    let resolvedMediaUrl = '';

    if (stream.infoHash) {
      addLog(`[P2P] InfoHash detectado: ${stream.infoHash}`);
      resolvedMediaUrl = `magnet:?xt=urn:btih:${stream.infoHash}`;
    } else if (stream.url) {
      addLog(`[NET] URL direta detectada.`);
      resolvedMediaUrl = stream.url;
    } else if (stream.ytId) {
      addLog(`[ERR] Streams do YouTube não são suportados nativamente.`);
      return;
    } else {
      addLog(`[ERR] Formato de stream desconhecido.`);
      return;
    }

    setMediaUrl(resolvedMediaUrl);
    
    // Generate Embed Link
    if (stream.addonUrl) {
      const currentUrl = new URL(window.location.href);
      currentUrl.searchParams.set('addon', encodeURIComponent(stream.addonUrl));
      currentUrl.searchParams.set('id', id);
      setEmbedLink(currentUrl.toString());
      addLog(`[SYS] Link de Embed gerado para este stream.`);
    }

    handlePlay(stream);
  };

  // --- Player Core ---
  const initPlayer = (url: string, isTorrent: boolean = false) => {
    setIsIframeMode(false);
    if (artPlayerRef.current) {
      artPlayerRef.current.destroy(false);
      artPlayerRef.current = null;
    }

    if (!playerContainerRef.current) return;

    if (!window.Artplayer) {
      addLog(`[ERR] Módulo Artplayer ausente. Verifique a conexão.`);
      return;
    }

    addLog(`[UI] Montando interface do ArtPlayer...`);

    try {
      artPlayerRef.current = new window.Artplayer({
        container: playerContainerRef.current,
        url: isTorrent ? '' : url,
        theme: '#00ffcc', // Neon Cyan
        volume: 0.8,
        isLive: false,
        muted: true,
        autoplay: true,
        pip: true,
        autoSize: true,
        autoMini: true,
        screenshot: true,
        setting: true,
        loop: false,
        flip: true,
        playbackRate: true,
        aspectRatio: true,
        fullscreen: true,
        fullscreenWeb: true,
        subtitleOffset: true,
        miniProgressBar: true,
        mutex: true,
        backdrop: true,
        playsInline: true,
        autoPlayback: true,
        airplay: true,
        customType: {
          m3u8: function (video: HTMLVideoElement, streamUrl: string) {
            addLog(`[HLS] Interceptando stream m3u8...`);
            try {
              if (window.Hls && window.Hls.isSupported && window.Hls.isSupported()) {
                addLog(`[HLS] Inicializando motor Hls.js...`);
                const hls = new window.Hls({
                  debug: false,
                  enableWorker: false,
                  lowLatencyMode: true,
                });
                hls.loadSource(streamUrl);
                hls.attachMedia(video);
                hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
                  addLog(`[HLS] Manifesto decodificado. Buffer pronto.`);
                });
                hls.on(window.Hls.Events.ERROR, (event: any, data: any) => {
                  if (data.fatal) {
                    addLog(`[ERR] Falha fatal HLS: ${data.type} - ${data.details}`);
                    addLog(`[ERR] Erro: Fonte protegida ou offline. Tentando próxima...`);
                  } else {
                    addLog(`[WRN] Anomalia HLS: ${data.details}`);
                  }
                });
              } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
                video.src = streamUrl;
                addLog(`[HLS] Usando decodificador nativo do navegador.`);
              } else {
                addLog(`[ERR] Protocolo HLS não suportado neste ambiente.`);
              }
            } catch (err: any) {
              addLog(`[ERR] Falha ao inicializar HLS: ${err.message || 'Erro desconhecido'}`);
            }
          }
        }
      });

      artPlayerRef.current.on('ready', () => {
        addLog(`[UI] Motor de renderização de vídeo online.`);
      });
    } catch (err: any) {
      addLog(`[ERR] Falha ao inicializar o player: ${err.message || 'Erro desconhecido'}`);
    }
  };

  const fetchWithFallback = async (url: string, options: any = {}) => {
    // 1. Tenta conexão direta primeiro (RD e AD suportam CORS nativamente)
    try {
      const directRes = await fetch(url, options);
      // Retorna a resposta se for sucesso ou se for um erro da própria API (ex: 401, 403)
      if (directRes.ok || directRes.status >= 400) {
        return directRes;
      }
    } catch (e) {
      // Falha de CORS ou rede, continua para os proxies
    }

    // 2. Fallback para proxies caso a conexão direta falhe
    for (const proxy of proxies) {
      try {
        const targetUrl = `${proxy}${encodeURIComponent(url)}`;
        const res = await fetch(targetUrl, options);
        if (res.ok) return res;
      } catch (e) {
        continue;
      }
    }
    throw new Error('Todos os proxies falharam.');
  };

  const rdFetch = async (endpoint: string, apiKey: string, options: RequestInit = {}) => {
    const separator = endpoint.includes('?') ? '&' : '?';
    const url = `https://api.real-debrid.com/rest/1.0${endpoint}${separator}auth_token=${apiKey.trim()}`;
    return fetchWithFallback(url, options);
  };

  const adFetch = async (endpoint: string, apiKey: string, options: RequestInit = {}) => {
    const separator = endpoint.includes('?') ? '&' : '?';
    const url = `https://api.alldebrid.com/v4${endpoint}${separator}agent=embedflix&apikey=${apiKey.trim()}`;
    return fetchWithFallback(url, options);
  };

  const checkAllDebrid = async (infoHash: string, apiKey: string) => {
    addLog(`[AD] Iniciando fluxo AllDebrid para infoHash...`);
    try {
      const magnet = `magnet:?xt=urn:btih:${infoHash}`;
      const uploadRes = await adFetch(`/magnet/upload?magnets[]=${encodeURIComponent(magnet)}`, apiKey);
      const uploadData = await uploadRes.json();
      
      if (uploadData.status !== 'success' || !uploadData.data.magnets[0].id) {
        addLog(`[AD] Falha ao adicionar magnet no AllDebrid.`);
        return null;
      }
      
      const magnetId = uploadData.data.magnets[0].id;
      addLog(`[AD] Magnet adicionado (ID: ${magnetId}). Verificando status...`);
      
      const statusRes = await adFetch(`/magnet/status?id=${magnetId}`, apiKey);
      const statusData = await statusRes.json();
      
      if (statusData.status !== 'success' || statusData.data.magnets.status !== 'Ready') {
        addLog(`[AD] Torrent não está em cache ou ainda está baixando no AllDebrid.`);
        return null;
      }
      
      const links = statusData.data.magnets.links;
      if (!links || links.length === 0) {
        addLog(`[AD] Nenhum link encontrado no torrent.`);
        return null;
      }
      
      // Select largest file
      const largestLink = links.reduce((prev: any, curr: any) => (prev.size > curr.size) ? prev : curr);
      addLog(`[AD] Link selecionado: ${largestLink.filename}. Desbloqueando...`);
      
      const unlockRes = await adFetch(`/link/unlock?link=${encodeURIComponent(largestLink.link)}`, apiKey);
      const unlockData = await unlockRes.json();
      
      if (unlockData.status !== 'success') {
        addLog(`[AD] Falha ao desbloquear link.`);
        return null;
      }
      
      return unlockData.data.link;
    } catch (e) {
      addLog(`[ERR] Erro no fluxo AllDebrid: ${e instanceof Error ? e.message : 'Erro desconhecido'}`);
      return null;
    }
  };

  const checkRealDebrid = async (infoHash: string, apiKey: string) => {
    addLog(`[RD] Iniciando fluxo Real-Debrid para infoHash...`);
    try {
      // 0. Instant Availability
      addLog(`[RD] Etapa 0: Verificando disponibilidade instantânea...`);
      const availRes = await rdFetch(`/torrents/instantAvailability/${infoHash}`, apiKey);
      const availData = await availRes.json();
      
      const hashLower = infoHash.toLowerCase();
      if (!availData[hashLower] || !availData[hashLower].rd || availData[hashLower].rd.length === 0) {
        addLog(`[RD] Torrent não está em cache no Real-Debrid.`);
        return null;
      }
      addLog(`[RD] Cache encontrado! Iniciando conversão...`);

      // 1. Add Magnet
      addLog(`[RD] Etapa 1: Adicionando magnet link...`);
      const formData = new URLSearchParams();
      formData.append('magnet', `magnet:?xt=urn:btih:${infoHash}`);
      
      const addRes = await rdFetch('/torrents/addMagnet', apiKey, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formData.toString()
      });
      const addData = await addRes.json();
      const torrentId = addData.id;

      // 2. Get Info to find video file
      addLog(`[RD] Etapa 2: Obtendo informações do torrent (${torrentId})...`);
      const infoRes = await rdFetch(`/torrents/info/${torrentId}`, apiKey);
      const infoData = await infoRes.json();

      const videoFiles = infoData.files && infoData.files.filter((f: any) => f.path.match(/\.(mp4|mkv|avi|webm)$/i));
      if (!videoFiles || videoFiles.length === 0) {
        addLog(`[RD] Nenhum arquivo de vídeo encontrado no torrent.`);
        return null;
      }
      
      const selectedFile = videoFiles.reduce((prev: any, current: any) => (prev.bytes > current.bytes) ? prev : current);
      addLog(`[RD] Etapa 3: Selecionando arquivo ID ${selectedFile.id} (${(selectedFile.bytes / 1024 / 1024).toFixed(2)} MB)...`);

      // 3. Select File
      const selectData = new URLSearchParams();
      selectData.append('files', selectedFile.id.toString());
      await rdFetch(`/torrents/selectFiles/${torrentId}`, apiKey, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: selectData.toString()
      });

      // 4. Get Info again for the link
      addLog(`[RD] Etapa 4: Aguardando geração do link...`);
      const infoRes2 = await rdFetch(`/torrents/info/${torrentId}`, apiKey);
      const infoData2 = await infoRes2.json();

      if (!infoData2.links || infoData2.links.length === 0) {
        addLog(`[RD] Falha ao obter link do Real-Debrid. O torrent pode não estar em cache.`);
        return null;
      }

      // 5. Unrestrict Link
      addLog(`[RD] Etapa 5: Desbloqueando link (Unrestrict)...`);
      const unrestrictData = new URLSearchParams();
      unrestrictData.append('link', infoData2.links[0]);
      const unrestrictRes = await rdFetch('/unrestrict/link', apiKey, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: unrestrictData.toString()
      });
      const unrestrictJson = await unrestrictRes.json();

      if (unrestrictJson.download) {
        addLog(`[RD] Link direto obtido com sucesso!`);
        if (unrestrictJson.download.toLowerCase().endsWith('.mkv')) {
          addLog(`[WRN] O formato .mkv pode exigir suporte nativo do navegador. Recomendamos o uso do Google Chrome.`);
        }
        return unrestrictJson.download;
      }
      
      return null;
    } catch (err: any) {
      addLog(`[ERR] Erro no fluxo Real-Debrid: ${err.message}`);
      return null;
    }
  };

  const testRDConnection = async () => {
    if (!rdApiKey) {
      addLog('[RD] Insira uma API Key antes de testar.');
      return;
    }
    addLog('[RD] Testando conexão com a API...');
    try {
      const res = await rdFetch('/user', rdApiKey);
      const data = await res.json();
      addLog(`[RD] Conectado via URL Token! Usuário: ${data.username} | Premium: ${data.type === 'premium' ? 'Sim' : 'Não'}`);
    } catch (err: any) {
      addLog(`[ERR] Erro de Proxy ou falha ao testar RD: ${err.message}`);
    }
  };

  const testADConnection = async () => {
    if (!adApiKey) {
      addLog('[AD] Insira uma API Key antes de testar.');
      return;
    }
    addLog('[AD] Testando conexão com a API AllDebrid...');
    try {
      const res = await adFetch('/user', adApiKey);
      const data = await res.json();
      if (data.status === 'success') {
        addLog(`[AD] Conectado! Usuário: ${data.data.user.username} | Premium: ${data.data.user.isPremium ? 'Sim' : 'Não'}`);
      } else {
        addLog(`[ERR] Falha na autenticação AllDebrid: ${data.error.message}`);
      }
    } catch (err: any) {
      addLog(`[ERR] Erro ao testar AllDebrid: ${err.message}`);
    }
  };

  const handlePlay = async (stream: StremioStream) => {
    if (!stream) {
      addLog('[ERR] Stream inválido.');
      return;
    }

    if (webTorrentClientRef.current) {
      addLog('[P2P] Encerrando conexões WebRTC anteriores...');
      webTorrentClientRef.current.destroy();
      webTorrentClientRef.current = null;
    }

    if (stream.url) {
      addLog(`[NET] Detectado Link Direto. Carregando via HTTP...`);
      const finalUrl = applyGateway(stream.url);
      if (finalUrl !== stream.url) {
        addLog(`[NET] Bypass de CORS ativo para esta fonte...`);
      }
      initPlayer(finalUrl, false);
      return;
    }

    if (stream.infoHash) {
      setCurrentInfoHash(stream.infoHash);

      if (rdApiKey) {
        addLog(`[RD] Verificando cache instantâneo...`);
        const rdUrl = await checkRealDebrid(stream.infoHash, rdApiKey);
        if (rdUrl) {
          const finalUrl = applyGateway(rdUrl);
          addLog(`[NET] Roteando requisição via RD: ${finalUrl}`);
          initPlayer(finalUrl, false);
          return;
        }
      }

      if (adApiKey) {
        addLog(`[AD] Verificando cache instantâneo...`);
        const adUrl = await checkAllDebrid(stream.infoHash, adApiKey);
        if (adUrl) {
          const finalUrl = applyGateway(adUrl);
          addLog(`[NET] Roteando requisição via AD: ${finalUrl}`);
          initPlayer(finalUrl, false);
          return;
        }
      }

      const targetUrl = `magnet:?xt=urn:btih:${stream.infoHash}`;
      addLog(`[P2P] Handshake P2P iniciado. Preparando WebTorrent...`);
      
      if (!window.WebTorrent) {
         addLog(`[ERR] Módulo WebTorrent ausente.`);
         return;
      }

      try {
        if (!webTorrentClientRef.current) {
          webTorrentClientRef.current = new window.WebTorrent({
            maxConns: 100,
          });
        }
        const client = webTorrentClientRef.current;
        
        initPlayer('', true);

        const trackers = [
          'wss://tracker.btorrent.xyz',
          'wss://tracker.openwebtorrent.com',
          'wss://tracker.files.fm:7073/announce',
          'wss://tracker.gbitt.info:443/announce',
          'wss://tracker.webtorrent.dev',
          'wss://tracker.fastcast.nz'
        ];

        const torrentOptions = {
          announce: trackers
        };

        addLog(`[P2P] Conectando a ${trackers.length} Trackers WebRTC otimizados...`);
        
        let fallbackTimeout: NodeJS.Timeout;

        client.add(targetUrl, torrentOptions, (torrent: any) => {
          addLog(`[P2P] Swarm conectado. Hash: ${torrent.infoHash}`);
          
          const file = torrent.files.find((f: any) => 
            f.name.endsWith('.mkv') || 
            f.name.endsWith('.mp4') || 
            f.name.endsWith('.avi') ||
            f.name.endsWith('.webm')
          ) || torrent.files.reduce((prev: any, curr: any) => prev.length > curr.length ? prev : curr);
          
          if (!file) {
            addLog(`[ERR] Nenhum arquivo de mídia encontrado no torrent.`);
            clearTimeout(fallbackTimeout);
            return;
          }

          addLog(`[SYS] Arquivo selecionado: ${file.name} (${(file.length / 1024 / 1024).toFixed(2)} MB)`);
          addLog(`[SYS] Estabelecendo pipeline de renderização direta...`);
          
          if (!artPlayerRef.current) {
             addLog(`[ERR] Instância do player não encontrada.`);
             return;
          }
          
          const videoElement = artPlayerRef.current.video;
          if (videoElement) {
            videoElement.id = 'artplayer-v-id';
            file.renderTo(videoElement, {
                autoplay: true,
                controls: false
            }, (err: any) => {
                if(err) addLog(`[ERR] Falha no pipeline: ${err.message}`);
            });
          }

          torrent.on('wire', (wire: any, addr: string) => {
            addLog(`[P2P] Peer conectado! Total: ${torrent.numPeers}`);
          });

          let hasPeers = false;

          torrent.on('download', (bytes: number) => {
             if (torrent.numPeers > 0 && !hasPeers) {
                 hasPeers = true;
                 clearTimeout(fallbackTimeout);
             }
             if (Math.random() < 0.05) {
               const speed = (torrent.downloadSpeed / 1024 / 1024).toFixed(2);
               addLog(`[P2P] Download: ${speed} MB/s | Peers: ${torrent.numPeers}`);
             }
          });

          torrent.on('done', () => {
              addLog(`[P2P] Transferência de blocos concluída. Integridade 100%.`);
          });
        });

        fallbackTimeout = setTimeout(async () => {
            if (client.torrents.length > 0 && client.torrents[0].numPeers === 0) {
                addLog(`[WRN] P2P lento (8s sem peers).`);
                
                if (rdApiKey) {
                  addLog(`[RD] Tentando fallback automático via Real-Debrid...`);
                  const rdUrl = await checkRealDebrid(stream.infoHash!, rdApiKey);
                  if (rdUrl) {
                    const finalUrl = applyGateway(rdUrl);
                    addLog(`[NET] Roteando requisição via RD: ${finalUrl}`);
                    initPlayer(finalUrl, false);
                    if (webTorrentClientRef.current) {
                      webTorrentClientRef.current.destroy();
                      webTorrentClientRef.current = null;
                    }
                    return;
                  }
                }

                if (adApiKey) {
                  addLog(`[AD] Tentando fallback automático via AllDebrid...`);
                  const adUrl = await checkAllDebrid(stream.infoHash!, adApiKey);
                  if (adUrl) {
                    const finalUrl = applyGateway(adUrl);
                    addLog(`[NET] Roteando requisição via AD: ${finalUrl}`);
                    initPlayer(finalUrl, false);
                    if (webTorrentClientRef.current) {
                      webTorrentClientRef.current.destroy();
                      webTorrentClientRef.current = null;
                    }
                    return;
                  }
                }
                
                addLog(`[WRN] Buscando fontes diretas (Embed)...`);
                switchToDirectSource();
            }
        }, 8000);

        client.on('error', (err: any) => {
          addLog(`[ERR] Exceção no motor P2P: ${err.message}`);
        });
      } catch (err: any) {
        addLog(`[ERR] Falha ao inicializar WebTorrent: ${err.message || 'Erro desconhecido'}`);
      }
    } else {
      addLog(`[ERR] Formato de stream desconhecido.`);
    }
  };

  useEffect(() => {
    return () => {
      try {
        if (artPlayerRef.current) artPlayerRef.current.destroy(false);
      } catch (e) {
        console.error('Error destroying Artplayer:', e);
      }
      try {
        if (webTorrentClientRef.current) webTorrentClientRef.current.destroy();
      } catch (e) {
        console.error('Error destroying WebTorrent:', e);
      }
    };
  }, []);

  return (
    <div className="min-h-screen bg-[#030712] text-slate-300 font-sans selection:bg-[#00ffcc]/30">
      {/* --- Header --- */}
      <header className="sticky top-0 z-50 bg-[#030712]/70 backdrop-blur-2xl border-b border-[#00ffcc]/20 shadow-[0_4px_30px_rgba(0,255,204,0.05)]">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#00ffcc] to-[#0066ff] flex items-center justify-center shadow-[0_0_20px_rgba(0,255,204,0.4)] relative overflow-hidden">
              <div className="absolute inset-0 bg-white/20 mix-blend-overlay"></div>
              <Play className="w-4 h-4 text-black ml-0.5 relative z-10" fill="currentColor" />
            </div>
            <h1 className="text-2xl font-black tracking-tighter text-transparent bg-clip-text bg-gradient-to-r from-white to-slate-400 drop-shadow-[0_0_10px_rgba(255,255,255,0.2)]">
              EMBED<span className="text-[#00ffcc]">FLIX</span>
            </h1>
          </div>

          <div className="flex-1 max-w-xl mx-8 flex items-center gap-2">
            <div className="relative flex-1 group">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                <Search className="h-4 w-4 text-[#00ffcc]/50 group-focus-within:text-[#00ffcc] transition-colors" />
              </div>
              <input
                type="text"
                placeholder="ID Universal (ex: tt0137523)..."
                value={tmdbId}
                onChange={(e) => setTmdbId(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleMultiDiscovery()}
                className="w-full bg-[#0f172a]/80 border border-slate-800 rounded-2xl py-2.5 pl-11 pr-4 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-[#00ffcc]/50 focus:ring-1 focus:ring-[#00ffcc]/50 transition-all shadow-inner backdrop-blur-sm"
              />
            </div>
            <button 
              onClick={() => handleMultiDiscovery()}
              disabled={isSearching}
              className="px-5 py-2.5 bg-[#00ffcc]/10 hover:bg-[#00ffcc]/20 border border-[#00ffcc]/30 rounded-2xl text-[#00ffcc] text-sm font-bold tracking-wide transition-all hover:shadow-[0_0_20px_rgba(0,255,204,0.2)] active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {isSearching ? <Activity className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              Buscar
            </button>
          </div>

          <button 
            onClick={() => setIsSettingsOpen(!isSettingsOpen)}
            className={`p-2.5 rounded-xl transition-all duration-300 ${isSettingsOpen ? 'bg-[#00ffcc]/20 text-[#00ffcc] shadow-[0_0_15px_rgba(0,255,204,0.3)] rotate-90' : 'text-slate-500 hover:text-[#00ffcc] hover:bg-slate-900'}`}
          >
            <Settings className="w-5 h-5" />
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8 grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* --- Left Column: Player & Terminal --- */}
        <div className="lg:col-span-2 flex flex-col gap-6">
          
          {/* Player Container */}
          <div className="relative w-full aspect-video bg-[#050b14] rounded-3xl overflow-hidden border border-slate-800/80 shadow-[0_0_50px_rgba(0,0,0,0.8)] group ring-1 ring-white/5">
            {isIframeMode ? (
              <iframe 
                src={iframeUrl}
                className="absolute inset-0 w-full h-full z-10 border-0"
                allowFullScreen
                title="Direct Source Player"
              />
            ) : (
              <div ref={playerContainerRef} className="absolute inset-0 w-full h-full z-10"></div>
            )}
            
            {!artPlayerRef.current && !isIframeMode && (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-700 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-slate-900/40 to-[#030712] backdrop-blur-md z-0">
                <div className="relative">
                  <div className="absolute inset-0 bg-[#00ffcc] blur-[50px] opacity-10 rounded-full animate-pulse"></div>
                  <Network className="w-20 h-20 mb-6 opacity-20 relative z-10" />
                </div>
                <p className="text-sm font-mono uppercase tracking-[0.3em] opacity-40 text-[#00ffcc]">Aguardando Injeção de Stream</p>
              </div>
            )}

            {/* Fallback Button Overlay (Removed for Automation) */}
          </div>

          {/* Telemetry Console */}
          <div className="bg-[#050b14] border border-slate-800/80 rounded-2xl overflow-hidden shadow-[inset_0_0_20px_rgba(0,0,0,0.5)] flex flex-col h-56 relative ring-1 ring-white/5">
            <div className="flex items-center gap-3 px-5 py-3 bg-[#0a1120] border-b border-slate-800/80">
              <Terminal className="w-4 h-4 text-[#00ffcc]" />
              <span className="text-xs font-mono text-slate-400 uppercase tracking-[0.2em]">Telemetria do Sistema</span>
              <div className="ml-auto flex items-center gap-4">
                <button
                  onClick={copyLogsToClipboard}
                  className="p-1.5 text-slate-500 hover:text-[#00ffcc] hover:bg-[#00ffcc]/10 rounded-md transition-colors"
                  title="Copiar Logs"
                >
                  {logsCopied ? <CheckCircle2 className="w-4 h-4 text-[#00ffcc]" /> : <Copy className="w-4 h-4" />}
                </button>
                <div className="flex gap-2">
                  <div className="w-3 h-3 rounded-full bg-rose-500/20 border border-rose-500/50"></div>
                  <div className="w-3 h-3 rounded-full bg-amber-500/20 border border-amber-500/50"></div>
                  <div className="w-3 h-3 rounded-full bg-[#00ffcc]/40 border border-[#00ffcc] shadow-[0_0_10px_rgba(0,255,204,0.6)] animate-pulse"></div>
                </div>
              </div>
            </div>
            <div ref={terminalContainerRef} className="flex-1 p-5 overflow-y-auto font-mono text-[13px] leading-relaxed space-y-1.5 relative z-10">
              {logs.map((log, i) => {
                let colorClass = 'text-[#00ffcc]/70';
                if (log.includes('[ERR]')) colorClass = 'text-rose-400 font-bold drop-shadow-[0_0_5px_rgba(251,113,133,0.5)]';
                if (log.includes('[WRN]')) colorClass = 'text-amber-400';
                if (log.includes('[P2P]')) colorClass = 'text-emerald-400';
                if (log.includes('[SYS]')) colorClass = 'text-blue-400';
                if (log.includes('[RD]')) colorClass = 'text-purple-400 font-bold';
                if (log.includes('[AD]')) colorClass = 'text-fuchsia-400 font-bold';
                if (log.includes('[NET]')) colorClass = 'text-indigo-400';
                
                return (
                  <div key={i} className={`${colorClass} break-all`}>
                    <span className="opacity-50 mr-2">{log.split('] ')[0]}]</span>
                    {log.split('] ').slice(1).join('] ')}
                  </div>
                );
              })}
            </div>
            {/* CRT Scanline Effect */}
            <div className="absolute inset-0 pointer-events-none bg-[linear-gradient(transparent_50%,rgba(0,0,0,0.4)_50%)] bg-[length:100%_4px] opacity-30 z-20"></div>
            <div className="absolute inset-0 pointer-events-none bg-gradient-to-b from-transparent via-[#00ffcc]/5 to-transparent opacity-20 animate-[scan_4s_ease-in-out_infinite] z-20"></div>
          </div>
        </div>

        {/* --- Right Column: Settings, Streams & Metadata --- */}
        <div className="flex flex-col gap-6">
          
          {/* Settings Panel */}
          {isSettingsOpen && (
            <div className="bg-[#0a1120]/80 backdrop-blur-xl border border-[#00ffcc]/30 rounded-3xl p-6 shadow-[0_0_30px_rgba(0,255,204,0.05)] animate-in fade-in slide-in-from-top-4 duration-300 ring-1 ring-white/5 space-y-6">
              
              {/* Addon Manager */}
              <div>
                <h2 className="text-xs font-black uppercase tracking-[0.2em] text-[#00ffcc] mb-4 flex items-center gap-2">
                  <Box className="w-4 h-4" /> Gerenciador de Addons
                </h2>
                
                <div className="mb-4 space-y-2">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Addons Recomendados (Grátis)</p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        setNewAddonUrl('https://superflixapi.top/manifest.json');
                      }}
                      className="px-3 py-1.5 bg-slate-800/50 hover:bg-slate-700 border border-slate-700 rounded-lg text-xs text-slate-300 transition-colors flex items-center gap-1.5"
                    >
                      <Zap className="w-3 h-3 text-yellow-400" /> Superflix
                    </button>
                    <button
                      onClick={() => {
                        setNewAddonUrl('https://vizer.strem.fun/manifest.json');
                      }}
                      className="px-3 py-1.5 bg-slate-800/50 hover:bg-slate-700 border border-slate-700 rounded-lg text-xs text-slate-300 transition-colors flex items-center gap-1.5"
                    >
                      <Zap className="w-3 h-3 text-yellow-400" /> Vizer
                    </button>
                  </div>
                </div>

                <div className="flex gap-2 mb-4">
                  <input
                    type="text"
                    value={newAddonUrl}
                    onChange={(e) => setNewAddonUrl(e.target.value)}
                    placeholder="URL do manifest.json..."
                    className="flex-1 bg-[#030712] border border-slate-800 rounded-xl py-2 px-3 text-xs text-[#00ffcc] focus:border-[#00ffcc]/50 focus:outline-none font-mono"
                  />
                  <button
                    onClick={handleInstallAddon}
                    className="px-4 py-2 bg-[#00ffcc]/10 hover:bg-[#00ffcc]/20 border border-[#00ffcc]/30 rounded-xl text-[#00ffcc] text-xs font-bold transition-all"
                  >
                    Instalar
                  </button>
                </div>
                
                <div className="mb-2">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Addons Instalados</p>
                </div>

                <div className="space-y-2 max-h-40 overflow-y-auto pr-2">
                  {installedAddons.length === 0 ? (
                    <p className="text-[10px] text-slate-500 text-center py-2">Nenhum addon instalado.</p>
                  ) : (
                    installedAddons.map((addon, idx) => (
                      <div key={idx} className="flex items-center justify-between bg-[#030712]/50 border border-slate-800/50 rounded-lg p-2.5">
                        <div className="flex flex-col overflow-hidden">
                          <span className="text-xs font-bold text-slate-300 truncate">{addon.name}</span>
                          <span className="text-[9px] text-slate-500 font-mono truncate">{addon.url}</span>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button 
                            onClick={() => {
                              navigator.clipboard.writeText(addon.url).then(() => {
                                addLog(`[SYS] URL do addon ${addon.name} copiada.`);
                              }).catch(err => {
                                addLog(`[ERR] Falha ao copiar URL: ${err}`);
                              });
                            }}
                            className="p-1.5 text-slate-500 hover:text-[#00ffcc] hover:bg-[#00ffcc]/10 rounded-md transition-colors"
                            title="Copiar URL do manifest"
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                          <button 
                            onClick={() => removeAddon(addon.url)}
                            className="p-1.5 text-slate-500 hover:text-rose-400 hover:bg-rose-400/10 rounded-md transition-colors"
                            title="Remover addon"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="h-px bg-slate-800/50"></div>

              {/* Network Config */}
              <div>
                <h2 className="text-xs font-black uppercase tracking-[0.2em] text-[#00ffcc] mb-4 flex items-center gap-2">
                  <Cpu className="w-4 h-4" /> Parâmetros de Rede
                </h2>
                <div className="space-y-4">
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">TMDB Auth Token</label>
                    <input
                      type="password"
                      value={tmdbApiKey}
                      onChange={(e) => setTmdbApiKey(e.target.value)}
                      className="w-full bg-[#030712] border border-slate-800 rounded-xl py-2 px-3 text-xs text-slate-200 focus:border-[#00ffcc]/50 focus:outline-none font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Real-Debrid API Key</label>
                    <div className="flex gap-2">
                      <input
                        type="password"
                        value={rdApiKey}
                        onChange={(e) => {
                          setRdApiKey(e.target.value);
                          localStorage.setItem('embedflix_rd_key', e.target.value);
                        }}
                        placeholder="Opcional: Cole sua API Key do Real-Debrid"
                        className="flex-1 bg-[#030712] border border-slate-800 rounded-xl py-2 px-3 text-xs text-slate-200 focus:border-[#00ffcc]/50 focus:outline-none font-mono"
                      />
                      <button 
                        onClick={testRDConnection}
                        className="px-3 py-2 bg-[#00ffcc]/10 hover:bg-[#00ffcc]/20 border border-[#00ffcc]/30 rounded-xl text-[#00ffcc] text-xs font-bold transition-all whitespace-nowrap"
                      >
                        Verificar Status
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">AllDebrid API Key</label>
                    <div className="flex gap-2">
                      <input
                        type="password"
                        value={adApiKey}
                        onChange={(e) => {
                          setAdApiKey(e.target.value);
                          localStorage.setItem('embedflix_ad_key', e.target.value);
                        }}
                        placeholder="Opcional: Cole sua API Key do AllDebrid"
                        className="flex-1 bg-[#030712] border border-slate-800 rounded-xl py-2 px-3 text-xs text-slate-200 focus:border-[#00ffcc]/50 focus:outline-none font-mono"
                      />
                      <button 
                        onClick={testADConnection}
                        className="px-3 py-2 bg-[#00ffcc]/10 hover:bg-[#00ffcc]/20 border border-[#00ffcc]/30 rounded-xl text-[#00ffcc] text-xs font-bold transition-all whitespace-nowrap"
                      >
                        Verificar Status
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Gateway Primário (CORS)</label>
                    <input
                      type="text"
                      value={gatewayPrefix}
                      onChange={(e) => setGatewayPrefix(e.target.value)}
                      className="w-full bg-[#030712] border border-slate-800 rounded-xl py-2 px-3 text-xs text-slate-200 focus:border-[#00ffcc]/50 focus:outline-none font-mono"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Streams List Panel */}
          <div className="bg-[#0a1120]/80 backdrop-blur-xl border border-slate-800/80 rounded-3xl p-6 ring-1 ring-white/5 shadow-xl flex flex-col max-h-[400px]">
            <h2 className="text-xs font-black uppercase tracking-[0.2em] text-slate-400 mb-4 flex items-center gap-2 shrink-0">
              <Server className="w-4 h-4 text-[#00ffcc]" /> Streams Disponíveis
            </h2>
            
            <div className="flex-1 overflow-y-auto space-y-2 pr-2">
              {isSearching ? (
                <div className="flex flex-col items-center justify-center h-32 gap-3">
                  <Activity className="w-6 h-6 text-[#00ffcc] animate-spin" />
                  <span className="text-xs font-mono text-slate-500 uppercase tracking-widest">Varrendo Addons...</span>
                </div>
              ) : availableStreams.length > 0 ? (
                availableStreams.map((stream, idx) => (
                  <button
                    key={idx}
                    onClick={() => selectStream(stream)}
                    className="w-full text-left bg-[#030712]/80 hover:bg-[#00ffcc]/5 border border-slate-800 hover:border-[#00ffcc]/30 rounded-xl p-3 transition-all group flex flex-col gap-1"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-[#00ffcc] uppercase tracking-wider flex items-center gap-1.5">
                        {stream.addonName}
                      </span>
                      <span className="text-[10px] font-mono text-slate-500 bg-slate-900 px-1.5 py-0.5 rounded flex items-center gap-1">
                        {stream.infoHash ? 'P2P/Torrent' : <><Zap className="w-3 h-3 text-yellow-400" /> HTTP/HLS</>}
                      </span>
                    </div>
                    <span className="text-sm font-medium text-slate-200 group-hover:text-white transition-colors line-clamp-2">
                      {stream.title || stream.name || 'Stream sem título'}
                    </span>
                  </button>
                ))
              ) : (
                <div className="flex flex-col items-center justify-center h-32 text-center gap-2">
                  <Box className="w-6 h-6 text-slate-700" />
                  <p className="text-xs text-slate-500 font-mono">Nenhum stream encontrado.<br/>Busque um ID ou instale addons.</p>
                </div>
              )}
            </div>
          </div>

          {/* Embed Link Generator Panel */}
          {embedLink && (
            <div className="bg-[#00ffcc]/5 border border-[#00ffcc]/30 rounded-3xl p-6 ring-1 ring-[#00ffcc]/20 shadow-[0_0_30px_rgba(0,255,204,0.1)] animate-in fade-in slide-in-from-bottom-4">
              <h2 className="text-xs font-black uppercase tracking-[0.2em] text-[#00ffcc] mb-3 flex items-center gap-2">
                <LinkIcon className="w-4 h-4" /> Link de Embed Gerado
              </h2>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={embedLink}
                  className="w-full bg-[#030712]/80 border border-[#00ffcc]/20 rounded-xl py-2.5 px-4 text-xs text-slate-300 focus:outline-none font-mono"
                />
                <button
                  onClick={copyToClipboard}
                  className="p-2.5 bg-[#00ffcc]/20 hover:bg-[#00ffcc]/30 text-[#00ffcc] rounded-xl transition-all"
                  title="Copiar Link"
                >
                  {copied ? <CheckCircle2 className="w-5 h-5" /> : <Copy className="w-5 h-5" />}
                </button>
              </div>
              <p className="text-[10px] text-slate-500 mt-3 leading-relaxed">
                Este link carrega o EmbedFlix e inicia automaticamente a reprodução deste stream específico.
              </p>
            </div>
          )}

          {/* Metadata Panel */}
          {movieData ? (
            <div className="bg-[#0a1120]/80 backdrop-blur-xl border border-slate-800/80 rounded-3xl overflow-hidden relative group ring-1 ring-white/5 shadow-xl">
              <div 
                className="absolute inset-0 opacity-10 mix-blend-screen blur-2xl scale-110 transition-all duration-1000 group-hover:opacity-20"
                style={{ backgroundImage: `url(https://image.tmdb.org/t/p/w500${movieData.poster_path})`, backgroundSize: 'cover', backgroundPosition: 'center' }}
              ></div>
              
              <div className="relative p-6 flex flex-col gap-5">
                <div className="flex gap-5">
                  {movieData.poster_path ? (
                    <div className="relative shrink-0">
                      <div className="absolute inset-0 bg-[#00ffcc] blur-md opacity-20 rounded-xl"></div>
                      <img 
                        src={`https://image.tmdb.org/t/p/w500${movieData.poster_path}`} 
                        alt={movieData.title || movieData.name}
                        className="w-28 h-40 object-cover rounded-xl shadow-2xl border border-white/10 relative z-10"
                        referrerPolicy="no-referrer"
                      />
                    </div>
                  ) : (
                    <div className="w-28 h-40 bg-[#030712] rounded-xl flex items-center justify-center border border-white/5 shrink-0">
                      <Film className="w-8 h-8 text-slate-700" />
                    </div>
                  )}
                  
                  <div className="flex flex-col justify-center">
                    <h3 className="text-xl font-black text-white leading-tight mb-2 tracking-tight">{movieData.title || movieData.name}</h3>
                    <div className="flex flex-wrap items-center gap-2 text-xs font-bold text-[#00ffcc] mb-3">
                      <span className="px-2 py-1 bg-[#00ffcc]/10 border border-[#00ffcc]/20 rounded-md backdrop-blur-sm">
                        {movieData.release_date?.split('-')[0] || 'N/A'}
                      </span>
                      <span className="flex items-center gap-1 px-2 py-1 bg-slate-800/50 border border-slate-700 rounded-md">
                        <span className="text-amber-400">★</span> {movieData.vote_average?.toFixed(1) || 'N/A'}
                      </span>
                    </div>
                  </div>
                </div>
                
                <div className="pt-4 border-t border-slate-800/80">
                  <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 mb-2">Decodificação de Enredo</h4>
                  <p className="text-sm text-slate-400 leading-relaxed line-clamp-5 font-medium">
                    {movieData.overview || 'Dados de enredo indisponíveis no banco de dados atual.'}
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-[#0a1120]/40 border border-slate-800/50 border-dashed rounded-3xl p-10 flex flex-col items-center justify-center text-center gap-4 h-full min-h-[250px]">
              <div className="w-12 h-12 rounded-full bg-slate-900 flex items-center justify-center border border-slate-800">
                <ShieldAlert className="w-5 h-5 text-slate-600" />
              </div>
              <p className="text-xs font-mono text-slate-500 uppercase tracking-widest leading-relaxed">
                Aguardando sincronização<br/>de metadados TMDB
              </p>
            </div>
          )}

        </div>
      </main>
    </div>
  );
}
