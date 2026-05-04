import React, { Component, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence, useMotionValue, useTransform } from 'framer-motion';
import { Plus, LogIn, LogOut, Save, Cloud, CloudOff, Move, Edit3, Target, Minus, Maximize2, Layout, Search, X } from 'lucide-react';
import { auth, db } from './firebase';
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  signOut,
  User
} from 'firebase/auth';
import { 
  doc, 
  setDoc, 
  onSnapshot, 
  collection, 
  query, 
  where, 
  limit,
  getDocFromServer,
  getDocsFromServer,
  Timestamp
} from 'firebase/firestore';

interface Particle {
  tx: number; // target x
  ty: number; // target y
  tz: number; // target z
  x: number;  // current x
  y: number;  // current y
  z: number;  // current z
  size: number;
  color: { r: number; g: number; b: number; a: number };
  targetColor: { r: number; g: number; b: number; a: number };
  phase: number; // for individual motion
}

const PARTICLE_COUNT = 1500;
const INTRO_DURATION = 2000; // Faster intro
const DISPERSE_SPEED = 0.02;

type AppPhase = 'assembling' | 'sphere' | 'dispersing' | 'loading' | 'space';
type ModalStep = 'none' | 'auth' | 'typeName' | 'userName' | 'addNodeName' | 'nodeDetails';
type Direction = 'ancestor' | 'descendant' | 'sibling-left' | 'sibling-right';

interface Link {
  id: string;
  from: string;
  to: string;
}

interface Node {
  id: string;
  label: string;
  x: number;
  y: number;
  z: number;
  type: 'user' | 'ancestor' | 'descendant' | 'sibling';
  parentId?: string;
  createdAt: number;
  birthDate?: string;
  profession?: string;
  bio?: string;
}

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string;
    email?: string | null;
    emailVerified?: boolean;
    isAnonymous?: boolean;
    tenantId?: string | null;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

const CustomCursor = ({ isSelectionMode }: { isSelectionMode: boolean }) => {
  const mouseX = useMotionValue(-100);
  const mouseY = useMotionValue(-100);
  const [isHovering, setIsHovering] = useState(false);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      mouseX.set(e.clientX);
      mouseY.set(e.clientY);
      
      const target = e.target as HTMLElement;
      const isInteractive = target.closest('button, a, input, textarea, [role="button"], .cursor-pointer');
      setIsHovering(!!isInteractive);
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, [mouseX, mouseY]);

  return (
    <div className="fixed inset-0 pointer-events-none z-[9999]">
      <motion.div
        style={{
          x: mouseX,
          y: mouseY,
          translateX: '-50%',
          translateY: '-50%',
        }}
        animate={{
          scale: isSelectionMode ? 2.5 : (isHovering ? 2 : 1),
          backgroundColor: isSelectionMode ? 'rgba(59, 130, 246, 1)' : (isHovering ? 'rgba(255, 255, 255, 1)' : 'rgba(255, 255, 255, 0.6)'),
          borderRadius: isSelectionMode ? '2px' : '9999px',
        }}
        className="w-1.5 h-1.5 shadow-[0_0_8px_rgba(255,255,255,0.3)] flex items-center justify-center"
      >
        {isSelectionMode && (
          <div className="w-full h-full border border-white/50" />
        )}
      </motion.div>
    </div>
  );
};

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error("ErrorBoundary caught an error", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="fixed inset-0 flex items-center justify-center bg-black text-white p-4 text-center z-[9999]">
          <div className="max-w-md">
            <h1 className="text-xl font-bold mb-2">Что-то пошло не так</h1>
            <p className="opacity-70 mb-4 text-sm">
              Произошла ошибка. Если это ошибка доступа к базе данных, убедитесь, что вы вошли в систему.
            </p>
            <div className="flex gap-2 justify-center">
              <button 
                onClick={() => window.location.reload()}
                className="px-4 py-2 bg-white text-black rounded-full text-sm font-medium"
              >
                Обновить страницу
              </button>
              <button 
                onClick={() => this.setState({ hasError: false })}
                className="px-4 py-2 bg-white/10 text-white rounded-full text-sm font-medium"
              >
                Попробовать снова
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

const SpatialElement = React.memo(({ children, x: nx, y: ny, z: nz, cameraX, cameraY, scale, dimensions, className }: any) => {
  const parallax = 0.5 + ((nz + 4000) / 8000);
  const centerX = dimensions.width / 2;
  const centerY = dimensions.height / 2;
  
  const x = useTransform([cameraX, scale], ([cx, s]: any) => ((nx - cx * parallax) * s) + centerX);
  const y = useTransform([cameraY, scale], ([cy, s]: any) => ((ny - cy * parallax) * s) + centerY);
  const s = useTransform(scale, (val: number) => val);
  
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        x,
        y,
        scale: s,
        translateX: '-50%',
        translateY: '-50%',
        zIndex: Math.round(parallax * 100),
        pointerEvents: 'auto'
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
});

const NodeCard = React.memo(({ 
  node, 
  cameraX, 
  cameraY, 
  scale,
  dimensions, 
  onClick, 
  onLinkStart, 
  onLinkEnter, 
  onLinkLeave,
  onDragStart,
  isLinkingTarget,
  isEditMode,
  isSelected,
  isHighlighted = false
}: any) => {
  const parallax = 0.5 + ((node.z + 4000) / 8000);
  const mouseDownPos = useRef({ x: 0, y: 0 });
  const mouseDownTime = useRef(0);
  
  const dimRef = useRef(dimensions);
  useEffect(() => {
    dimRef.current = dimensions;
  }, [dimensions]);

  const x = useTransform([cameraX, scale], ([cx, s]: any) => ((node.x - cx * parallax) * s) + dimRef.current.width / 2);
  const y = useTransform([cameraY, scale], ([cy, s]: any) => ((node.y - cy * parallax) * s) + dimRef.current.height / 2);
  const s = useTransform(scale, (val: number) => val);
  
  const handleMouseDown = (e: React.MouseEvent) => {
    mouseDownPos.current = { x: e.clientX, y: e.clientY };
    mouseDownTime.current = Date.now();
    
    if (isEditMode) {
      e.stopPropagation();
      onDragStart(node.id, e.clientX, e.clientY);
    }
  };

  const handleClick = (e: React.MouseEvent) => {
    const dist = Math.sqrt(
      Math.pow(e.clientX - mouseDownPos.current.x, 2) + 
      Math.pow(e.clientY - mouseDownPos.current.y, 2)
    );
    const duration = Date.now() - mouseDownTime.current;
    
    // Only trigger if it was a quick click with minimal movement
    if (dist < 5 && duration < 300) {
      onClick(e);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      onMouseDown={handleMouseDown}
      onClick={handleClick}
      onMouseEnter={() => onLinkEnter(node.id)}
      onMouseLeave={() => onLinkLeave(node.id)}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        x,
        y,
        scale: s,
        translateX: '-50%',
        translateY: '-50%',
        zIndex: Math.round(parallax * 100),
        pointerEvents: 'auto'
      }}
      className="group"
    >
      <div className={`bg-zinc-900/90 backdrop-blur-2xl border p-6 rounded-lg shadow-[0_0_30px_rgba(255,255,255,0.1)] min-w-[180px] text-center relative overflow-hidden transition-all duration-300 ${
        isHighlighted ? 'border-yellow-400/80 shadow-[0_0_40px_rgba(250,204,21,0.3)] ring-2 ring-yellow-400/20' :
        isSelected ? 'border-blue-400 shadow-[0_0_40px_rgba(59,130,246,0.4)] scale-[1.02]' :
        isLinkingTarget ? 'border-white shadow-[0_0_50px_rgba(255,255,255,0.3)]' : 
        isEditMode ? 'border-blue-500/50 shadow-[0_0_20px_rgba(59,130,246,0.2)]' :
        'border-white/30 group-hover:border-white/50'
      }`}>
        {isEditMode && (
          <div className="absolute top-2 right-2">
            <Move size={12} className="text-blue-400 opacity-50" />
          </div>
        )}
        <div className="absolute top-0 left-0 w-full h-[1px] bg-white/40" />
        
        <div className="text-[10px] text-white/20 uppercase tracking-[0.4em] mb-3 font-light">
          {node.type === 'user' ? 'Origin' : node.type}
        </div>
        <div className="text-lg font-light tracking-widest text-white/90 uppercase">{node.label}</div>
        
        {node.profession && (
          <div className="text-[10px] text-white/40 mt-2 italic tracking-wider">{node.profession}</div>
        )}

        {/* Link Handle */}
        {isEditMode && (
          <div 
            onMouseDown={(e) => {
              e.stopPropagation();
              onLinkStart(node.id);
            }}
            className="absolute bottom-2 left-1/2 -translate-x-1/2 w-8 h-4 flex items-center justify-center group/handle"
            title="Drag to link"
          >
            <div className="w-1.5 h-1.5 bg-white/40 rounded-full group-hover/handle:bg-white transition-all shadow-[0_0_10px_rgba(255,255,255,0.2)]" />
          </div>
        )}
      </div>
      
      {/* Visual Glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-32 h-32 bg-white/5 rounded-full blur-3xl pointer-events-none" />
    </motion.div>
  );
});

const GhostCard = React.memo(({ x: nx, y: ny, z: nz, cameraX, cameraY, scale, dimensions, onClick, isDimmed = false }: any) => {
  const parallax = 0.5 + ((nz + 4000) / 8000);
  
  const dimRef = useRef(dimensions);
  useEffect(() => {
    dimRef.current = dimensions;
  }, [dimensions]);

  const x = useTransform([cameraX, scale], ([cx, s]: any) => ((nx - cx * parallax) * s) + dimRef.current.width / 2);
  const y = useTransform([cameraY, scale], ([cy, s]: any) => ((ny - cy * parallax) * s) + dimRef.current.height / 2);
  const s = useTransform(scale, (val: number) => val);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ 
        opacity: isDimmed ? 0.1 : 0.5
      }}
      whileHover={!isDimmed ? { opacity: 1 } : {}}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        x,
        y,
        scale: s,
        translateX: '-50%',
        translateY: '-50%',
        zIndex: Math.round(parallax * 100),
        pointerEvents: isDimmed ? 'none' : 'auto'
      }}
      onClick={onClick}
      className="group"
    >
      <div className={`
        rounded-full flex flex-col items-center justify-center transition-all duration-500
        ${isDimmed 
          ? 'w-8 h-8 bg-white/5 border border-white/10' 
          : 'w-12 h-12 bg-white/10 border border-white/30 shadow-[0_0_20px_rgba(255,255,255,0.05)] group-hover:shadow-[0_0_30px_rgba(255,255,255,0.15)] group-hover:bg-white/20 group-hover:border-white/50'
        }
      `}>
        {!isDimmed && <Plus size={18} className="text-white/60 group-hover:text-white transition-colors" />}
        
        {/* Tooltip text on hover */}
        {!isDimmed && (
          <div className="absolute top-full left-1/2 -translate-x-1/2 mt-3 opacity-0 group-hover:opacity-100 transition-all duration-300 pointer-events-none translate-y-2 group-hover:translate-y-0">
            <div className="bg-black/80 border border-white/10 px-3 py-1.5 rounded-md whitespace-nowrap">
              <span className="text-[9px] uppercase tracking-[0.2em] text-white/80 font-medium">Add Connection</span>
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
});

const Navigator = React.memo(({ 
  nodes, 
  cameraX, 
  cameraY, 
  scale, 
  dimensions, 
  onJump 
}: { 
  nodes: Node[], 
  cameraX: any, 
  cameraY: any, 
  scale: any, 
  dimensions: { width: number, height: number },
  onJump: (x: number, y: number) => void
}) => {
  const bounds = React.useMemo(() => {
    if (nodes.length === 0) {
      return { minX: -1000, minY: -1000, maxX: 1000, maxY: 1000 };
    }
    const xs = nodes.map((n: Node) => n.x);
    const ys = nodes.map((n: Node) => n.y);
    return {
      minX: Math.min(...xs) - 1500,
      maxX: Math.max(...xs) + 1500,
      minY: Math.min(...ys) - 1500,
      maxY: Math.max(...ys) + 1500
    };
  }, [nodes]);

  const navSize = 160;
  const worldW = bounds.maxX - bounds.minX;
  const worldH = bounds.maxY - bounds.minY;
  const aspect = worldW / worldH;
  
  const mapW = aspect > 1 ? navSize : navSize * aspect;
  const mapH = aspect > 1 ? navSize / aspect : navSize;

  const toNavX = (worldX: number) => ((worldX - bounds.minX) / worldW) * mapW;
  const toNavY = (worldY: number) => ((worldY - bounds.minY) / worldH) * mapH;

  // Viewport representation
  const vpX = useTransform(cameraX, (cx: number) => toNavX(cx - (dimensions.width / 2) / (scale.get() as number)));
  const vpY = useTransform(cameraY, (cy: number) => toNavY(cy - (dimensions.height / 2) / (scale.get() as number)));
  const vpW = useTransform(scale, (s: number) => (dimensions.width / s / worldW) * mapW);
  const vpH = useTransform(scale, (s: number) => (dimensions.height / s / worldH) * mapH);

  return (
    <div className="p-2 bg-zinc-900/80 border border-white/10 rounded-xl backdrop-blur-xl shadow-2xl group">
      <div 
        className="relative bg-black/40 rounded overflow-hidden border border-white/5"
        style={{ width: mapW, height: mapH }}
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const nx = (e.clientX - rect.left) / mapW;
          const ny = (e.clientY - rect.top) / mapH;
          onJump(bounds.minX + nx * worldW, bounds.minY + ny * worldH);
        }}
      >
        {/* Nodes */}
        {nodes.map((n: any) => (
          <div 
            key={n.id}
            className="absolute w-1 h-1 bg-white/30 rounded-full"
            style={{ left: toNavX(n.x), top: toNavY(n.y), transform: 'translate(-50%, -50%)' }}
          />
        ))}
        
        {/* Viewport */}
        <motion.div 
          style={{ 
            position: 'absolute',
            x: vpX, y: vpY, width: vpW, height: vpH,
            border: '1px solid rgba(255,255,255,0.4)',
            backgroundColor: 'rgba(255,255,255,0.05)',
            pointerEvents: 'none'
          }}
        />
      </div>
      <div className="mt-2 text-[8px] uppercase tracking-[0.3em] text-white/20 text-center group-hover:text-white/40 transition-colors">Navigator</div>
    </div>
  );
});

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dimensions, setDimensions] = useState({ 
    width: typeof window !== 'undefined' ? window.innerWidth : 1920, 
    height: typeof window !== 'undefined' ? window.innerHeight : 1080 
  });
  
  const [phase, setPhase] = useState<AppPhase>('assembling');
  const [modalStep, setModalStep] = useState<ModalStep>('none');
  const [typeName, setTypeName] = useState('');
  const [userName, setUserName] = useState('');
  const [inputValue, setInputValue] = useState('');
  const [pendingNode, setPendingNode] = useState<{ parentId?: string, direction: Direction } | null>(null);
  const [nodes, setNodes] = useState<Node[]>([]);
  const nodesRef = useRef<Node[]>([]);
  const [links, setLinks] = useState<Link[]>([]);
  const linksRef = useRef<Link[]>([]);
  const [hasInteracted, setHasInteracted] = useState(false);
  
  // Node Details State
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [linkingFromId, setLinkingFromId] = useState<string | null>(null);
  const [linkingTargetId, setLinkingTargetId] = useState<string | null>(null);
  const linkingFromIdRef = useRef<string | null>(null);
  const linkingTargetIdRef = useRef<string | null>(null);
  const mousePosRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    linkingFromIdRef.current = linkingFromId;
  }, [linkingFromId]);

  useEffect(() => {
    linkingTargetIdRef.current = linkingTargetId;
  }, [linkingTargetId]);
  
  const [isEditMode, setIsEditMode] = useState(false);
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const draggingNodeIdRef = useRef<string | null>(null);
  const dragStartPos = useRef({ x: 0, y: 0 });

  useEffect(() => {
    draggingNodeIdRef.current = draggingNodeId;
  }, [draggingNodeId]);
  
  const [editDetails, setEditDetails] = useState({
    label: '',
    birthDate: '',
    profession: '',
    bio: ''
  });

  // Selection State
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set());
  const [isCtrlPressed, setIsCtrlPressed] = useState(false);
  const [selectionBox, setSelectionBox] = useState<{ startX: number, startY: number, endX: number, endY: number } | null>(null);
  const selectionStartPos = useRef({ x: 0, y: 0 });
  const isCtrlPressedRef = useRef(false);

  // Firebase State
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<number | null>(null);
  const [treeId, setTreeId] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(true);
  const hasInitialLoaded = useRef(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  const cameraX = useMotionValue(0);
  const cameraY = useMotionValue(0);
  const scale = useMotionValue(1);

  const onLinkStart = React.useCallback((id: string) => {
    setLinkingFromId(id);
    linkingFromIdRef.current = id;
  }, []);

  const onLinkEnter = React.useCallback((id: string) => {
    if (linkingFromIdRef.current) {
      setLinkingTargetId(id);
      linkingTargetIdRef.current = id;
    }
  }, []);

  const onLinkLeave = React.useCallback((id: string) => {
    if (linkingTargetIdRef.current === id) {
      setLinkingTargetId(null);
      linkingTargetIdRef.current = null;
    }
  }, []);

  const onDragStart = React.useCallback((id: string, x: number, y: number) => {
    setDraggingNodeId(id);
    draggingNodeIdRef.current = id;
    dragStartPos.current = { x, y };
  }, []);

  const particles = useRef<Particle[]>([]);
  const rotation = useRef({ x: 0, y: 0 });
  const rotationSpeed = useRef(0.0008);
  const progress = useRef(0); 
  const cameraOffset = useRef({ x: 0, y: 0, z: 0 });
  const targetCameraOffset = useRef({ x: 0, y: 0, z: 0 });
  const lastTouch = useRef({ x: 0, y: 0 });
  const isDragging = useRef(false);

  const sphereRadius = Math.min(dimensions.width * 0.35, 200);

  // Firebase Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  // Test Connection
  useEffect(() => {
    async function testConnection() {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
        setIsOnline(true);
      } catch (error) {
        if (error instanceof Error && error.message.includes('the client is offline')) {
          setIsOnline(false);
        }
      }
    }
    testConnection();
  }, []);

  // Load Data - Only once on mount or user change
  useEffect(() => {
    if (!isAuthReady || hasInitialLoaded.current) return;

    if (!user) {
      // Fallback to local storage if not logged in
      const saved = localStorage.getItem('cosmic_type_data');
      if (saved) {
        try {
          const data = JSON.parse(saved);
          setNodes(data.nodes || []);
          nodesRef.current = data.nodes || [];
          setLinks(data.links || []);
          linksRef.current = data.links || [];
          setTypeName(data.typeName || '');
          setUserName(data.userName || '');
          hasInitialLoaded.current = true;
        } catch (e) {
          console.error("Local storage load error", e);
        }
      } else {
        hasInitialLoaded.current = true;
      }
      return;
    }

    const q = query(
      collection(db, 'trees'),
      where('ownerId', '==', user.uid),
      limit(1)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      // If we've already loaded or the user has started interacting, don't overwrite
      if (hasInitialLoaded.current) return;

      if (!snapshot.empty) {
        const data = snapshot.docs[0].data();
        setTreeId(snapshot.docs[0].id);
        
        // Only load if we are at the very beginning and haven't started editing
        if (nodesRef.current.length === 0 && !typeName && !userName) {
          const loadedNodes = data.nodes || [];
          const loadedLinks = data.links || [];
          
          setNodes(loadedNodes);
          nodesRef.current = loadedNodes;
          setLinks(loadedLinks);
          linksRef.current = loadedLinks;
          setTypeName(data.typeName || '');
          setUserName(data.userName || '');
          setModalStep('none');
          
          // CRITICAL: Don't set phase to 'space' here! 
          // Let the intro animation finish its job.
          hasInitialLoaded.current = true;
        }
      } else {
        hasInitialLoaded.current = true;
      }
    }, (error) => {
      console.error("Firestore sync error:", error);
      hasInitialLoaded.current = true;
    });

    return () => unsubscribe();
  }, [isAuthReady, user?.uid]); // Only depend on auth state change

  // Auto-save - increased delay to 5 seconds of inactivity
  useEffect(() => {
    if (!isAuthReady || !user) return;
    // Don't save if everything is empty
    if (!typeName && !userName && nodes.length === 0) return;

    const timer = setTimeout(async () => {
      // Save to local storage always
      localStorage.setItem('cosmic_type_data', JSON.stringify({
        typeName,
        userName,
        nodes,
        links,
        updatedAt: Date.now()
      }));

      if (!user) return;
      
      setIsSaving(true);
      try {
        const id = treeId || user.uid;
        // Clean data to remove any undefined values that Firestore doesn't support
        const dataToSave = JSON.parse(JSON.stringify({
          typeName,
          userName,
          nodes,
          links,
          ownerId: user.uid,
          updatedAt: Date.now()
        }));

        await setDoc(doc(db, 'trees', id), dataToSave, { merge: true });
        setTreeId(id);
        setLastSaved(Date.now());
      } catch (error) {
        console.error("Save error", error);
      } finally {
        setIsSaving(false);
      }
    }, 5000);

    return () => clearTimeout(timer);
  }, [nodes, links, typeName, userName, user, isAuthReady, treeId]);

  // Resize listener
  useEffect(() => {
    const handleResize = () => {
      setDimensions({ width: window.innerWidth, height: window.innerHeight });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Intro Animation
  useEffect(() => {
    if (particles.current.length === 0) {
      const newParticles: Particle[] = [];
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        const theta = Math.acos(Math.random() * 2 - 1);
        const phi = Math.random() * Math.PI * 2;
        
        const tx = sphereRadius * Math.sin(theta) * Math.cos(phi);
        const ty = sphereRadius * Math.sin(theta) * Math.sin(phi);
        const tz = sphereRadius * Math.cos(theta);
        
        const dist = 4000 + Math.random() * 2000;
        const angle = Math.random() * Math.PI * 2;
        const x = Math.cos(angle) * dist;
        const y = Math.sin(angle) * dist;
        const z = (Math.random() - 0.5) * dist;

        const colorFactor = (ty + sphereRadius) / (sphereRadius * 2);
        const r = colorFactor > 0.5 ? 255 : 255;
        const g = colorFactor > 0.5 ? 255 : 160 + Math.random() * 95;
        const b = colorFactor > 0.5 ? 255 : 60 + Math.random() * 40;
        const a = 0.4 + Math.random() * 0.4;

        const pColor = { r, g, b, a };

        newParticles.push({ 
          tx, ty, tz, x, y, z, 
          size: Math.random() * 1.2 + 0.4, 
          color: { ...pColor },
          targetColor: { ...pColor },
          phase: Math.random() * Math.PI * 2
        });
      }
      particles.current = newParticles;
    }

    // Phase management
    const timer = setTimeout(() => {
      setPhase('sphere');
      setTimeout(() => {
        setPhase('dispersing');
        // Set new targets for "Space"
        particles.current.forEach(p => {
          p.tx = (Math.random() - 0.5) * 4000;
          p.ty = (Math.random() - 0.5) * 4000;
          p.tz = (Math.random() - 0.5) * 8000;
          // Fade to white stars smoothly
          p.targetColor = {
            r: 255,
            g: 255,
            b: 255,
            a: 0.3 + Math.random() * 0.5
          };
        });
        setTimeout(() => {
          // Always go through 'loading' phase for a brief moment to ensure 
          // a smooth transition and allow data to settle
          setPhase('loading');
        }, 1000);
      }, 1500);
    }, 2000);

    return () => clearTimeout(timer);
  }, []); // Only run once on mount

  // Transition from loading to next step with safety timeout
  useEffect(() => {
    let safetyTimer: any;
    
    if (phase === 'loading') {
      // Safety transition: if data or auth takes too long, force space after 4s
      safetyTimer = setTimeout(() => {
        if (phase === 'loading') {
          console.log("Safety transition to space triggered");
          setPhase('space');
          if (!user && isAuthReady) setModalStep('auth');
        }
      }, 4000);

      if (isAuthReady) {
        if (!user) {
          // Not logged in -> Show Auth Modal after splash
          setTimeout(() => {
            setPhase('space');
            setModalStep('auth');
          }, 800);
        } else if (hasInitialLoaded.current) {
          // Logged in and data loaded -> Show Space
          setTimeout(() => {
            setPhase('space');
            if (nodesRef.current.length === 0) {
              setModalStep('typeName');
            } else {
              setModalStep('none');
            }
          }, 800);
        }
      }
    }
    
    return () => clearTimeout(safetyTimer);
  }, [phase, isAuthReady, user, hasInitialLoaded.current]);

  // Interaction handlers
  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey) {
        e.preventDefault();
        const newScale = Math.max(0.2, Math.min(3, scale.get() - e.deltaY * 0.002));
        scale.set(newScale);
        triggerMoving();
        return;
      }
      
      if (phase !== 'space') return;
      e.preventDefault();
      targetCameraOffset.current.x += e.deltaX;
      targetCameraOffset.current.y += e.deltaY;
      triggerMoving();
      if (!hasInteracted) setHasInteracted(true);
    };

    const handleTouchStart = (e: TouchEvent) => {
      lastTouch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (phase !== 'space') return;
      e.preventDefault();
      const dx = e.touches[0].clientX - lastTouch.current.x;
      const dy = e.touches[0].clientY - lastTouch.current.y;
      
      targetCameraOffset.current.x -= dx;
      targetCameraOffset.current.y -= dy; 
      
      lastTouch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      if (!hasInteracted) setHasInteracted(true);
    };

    const handleMouseDown = (e: MouseEvent) => {
      if (phase !== 'space') return;
      
      if (isCtrlPressedRef.current && isEditMode) {
        setSelectionBox({ startX: e.clientX, startY: e.clientY, endX: e.clientX, endY: e.clientY });
        selectionStartPos.current = { x: e.clientX, y: e.clientY };
        return;
      }

      // Clear selection if clicking background without CTRL
      if (!isCtrlPressedRef.current) {
        setSelectedNodeIds(new Set());
      }

      // Check if we clicked a node handle or something else
      // This is handled by NodeCard's own handlers, but we need to know if we should drag the camera
      if (draggingNodeIdRef.current || linkingFromIdRef.current) return;

      isDragging.current = true;
      lastTouch.current = { x: e.clientX, y: e.clientY };
    };

    const handleMouseMove = (e: MouseEvent) => {
      mousePosRef.current = { x: e.clientX, y: e.clientY };
      
      if (selectionBox) {
        setSelectionBox(prev => prev ? { ...prev, endX: e.clientX, endY: e.clientY } : null);
        return;
      }

      // Handle Node Dragging
      if (draggingNodeIdRef.current) {
        const dx = e.clientX - dragStartPos.current.x;
        const dy = e.clientY - dragStartPos.current.y;
        
        setNodes(prev => {
          const updated = prev.map(n => {
            if (n.id === draggingNodeIdRef.current) {
              return { ...n, x: n.x + dx, y: n.y + dy };
            }
            return n;
          });
          nodesRef.current = updated;
          return updated;
        });
        
        dragStartPos.current = { x: e.clientX, y: e.clientY };
        return;
      }

      if (!isDragging.current || phase !== 'space') return;
      const dx = e.clientX - lastTouch.current.x;
      const dy = e.clientY - lastTouch.current.y;
      
      targetCameraOffset.current.x -= dx;
      targetCameraOffset.current.y -= dy; 
      
      triggerMoving();
      lastTouch.current = { x: e.clientX, y: e.clientY };
      if (!hasInteracted) setHasInteracted(true);
    };

    const handleMouseUp = (e: MouseEvent) => {
      isDragging.current = false;
      
      if (selectionBox) {
        // Find nodes within selection box
        const rect = {
          left: Math.min(selectionBox.startX, selectionBox.endX),
          top: Math.min(selectionBox.startY, selectionBox.endY),
          right: Math.max(selectionBox.startX, selectionBox.endX),
          bottom: Math.max(selectionBox.startY, selectionBox.endY)
        };

        const newlySelected = new Set<string>();
        nodesRef.current.forEach(node => {
          const parallax = 0.5 + ((node.z + 4000) / 8000);
          const screenX = ((node.x - cameraOffset.current.x * parallax) * scale.get()) + dimensions.width / 2;
          const screenY = ((node.y - cameraOffset.current.y * parallax) * scale.get()) + dimensions.height / 2;

          if (screenX >= rect.left && screenX <= rect.right && screenY >= rect.top && screenY <= rect.bottom) {
            newlySelected.add(node.id);
          }
        });

        setSelectedNodeIds(prev => {
          const next = new Set(prev);
          newlySelected.forEach(id => next.add(id));
          return next;
        });
        setSelectionBox(null);
        return;
      }

      // Handle Dragging End
      if (draggingNodeIdRef.current) {
        const fromId = draggingNodeIdRef.current;
        const toId = linkingTargetIdRef.current;

        // If we dragged one node onto another in edit mode, create a link
        if (toId && fromId !== toId && isEditMode) {
          const exists = linksRef.current.some(l => 
            (l.from === fromId && l.to === toId) || (l.from === toId && l.to === fromId)
          );
          
          if (!exists) {
            const newLink: Link = {
              id: Math.random().toString(36).substr(2, 9),
              from: fromId,
              to: toId
            };
            setLinks(prev => {
              const updated = [...prev, newLink];
              linksRef.current = updated;
              return updated;
            });
          }
        }

        setDraggingNodeId(null);
        draggingNodeIdRef.current = null;
      }
      
      if (linkingFromIdRef.current && linkingTargetIdRef.current) {
        const fromId = linkingFromIdRef.current;
        const toId = linkingTargetIdRef.current;
        
        if (fromId !== toId) {
          // Check if link already exists
          const exists = linksRef.current.some(l => 
            (l.from === fromId && l.to === toId) || (l.from === toId && l.to === fromId)
          );
          
          if (!exists) {
            const newLink: Link = {
              id: Math.random().toString(36).substr(2, 9),
              from: fromId,
              to: toId
            };
            setLinks(prev => {
              const updated = [...prev, newLink];
              linksRef.current = updated;
              return updated;
            });
          }
        }
      }
      
      setLinkingFromId(null);
      linkingFromIdRef.current = null;
      setLinkingTargetId(null);
      linkingTargetIdRef.current = null;
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Control') {
        setIsCtrlPressed(true);
        isCtrlPressedRef.current = true;
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Control') {
        setIsCtrlPressed(false);
        isCtrlPressedRef.current = false;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('wheel', handleWheel, { passive: false });
    window.addEventListener('touchstart', handleTouchStart);
    window.addEventListener('touchmove', handleTouchMove, { passive: false });
    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('mouseleave', handleMouseUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('wheel', handleWheel);
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('mouseleave', handleMouseUp);
    };
  }, [phase, hasInteracted]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;
    let time = 0;

    const render = () => {
      time += 0.005;
      
      // Smooth camera movement
      cameraOffset.current.x += (targetCameraOffset.current.x - cameraOffset.current.x) * 0.05;
      cameraOffset.current.y += (targetCameraOffset.current.y - cameraOffset.current.y) * 0.05;
      cameraOffset.current.z += (targetCameraOffset.current.z - cameraOffset.current.z) * 0.05;

      cameraX.set(cameraOffset.current.x);
      cameraY.set(cameraOffset.current.y);

      // Rotation management
      if (phase === 'dispersing' || phase === 'space') {
        rotationSpeed.current *= 0.98; // Slow down rotation
      }
      rotation.current.y += rotationSpeed.current;

      ctx.fillStyle = 'black';
      ctx.fillRect(0, 0, dimensions.width, dimensions.height);

      const centerX = dimensions.width / 2;
      const centerY = dimensions.height / 2;

      // Draw Cosmic Threads
      if (phase === 'space' && nodesRef.current.length > 1) {
        ctx.save();
        const s = scale.get();
        
        // Helper to draw a connection line
        const drawLine = (n1: Node, n2: Node) => {
          const parallax1 = 0.5 + ((n1.z + 4000) / 8000);
          const x1 = ((n1.x - cameraOffset.current.x * parallax1) * s) + centerX;
          const y1 = ((n1.y - cameraOffset.current.y * parallax1) * s) + centerY;

          const parallax2 = 0.5 + ((n2.z + 4000) / 8000);
          const x2 = ((n2.x - cameraOffset.current.x * parallax2) * s) + centerX;
          const y2 = ((n2.y - cameraOffset.current.y * parallax2) * s) + centerY;

          const avgParallax = (parallax1 + parallax2) / 2;
          
          // Appearance effect
          const age = (Date.now() - Math.max(n1.createdAt, n2.createdAt)) / 1500;
          const progress = Math.min(age, 1);
          const alpha = progress;

          // Wavy path calculation
          const midX = (x1 + x2) / 2;
          const midY = (y1 + y2) / 2;
          
          // More organic curves
          const dist = Math.sqrt(Math.pow(x2-x1, 2) + Math.pow(y2-y1, 2));
          const waveAmp = Math.min(dist * 0.2, 60);
          const waveX = Math.sin(time * 0.8 + n1.x * 0.005) * waveAmp * avgParallax * s;
          const waveY = Math.cos(time * 0.7 + n1.y * 0.005) * waveAmp * avgParallax * s;
          
          const cpX = midX + waveX;
          const cpY = midY + waveY;

          // Simplified glow: only 2 strokes instead of 3
          ctx.globalAlpha = alpha;
          ctx.strokeStyle = `rgba(255, 255, 255, ${0.3 * alpha})`;
          ctx.lineWidth = 6 * avgParallax * s;
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.quadraticCurveTo(cpX, cpY, x2, y2);
          ctx.stroke();
          
          ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
          ctx.lineWidth = 1.5 * avgParallax * s;
          ctx.stroke();
          ctx.globalAlpha = 1;
        };

        // Draw manual links
        linksRef.current.forEach(link => {
          const fromNode = nodesRef.current.find(n => n.id === link.from);
          const toNode = nodesRef.current.find(n => n.id === link.to);
          if (fromNode && toNode) drawLine(fromNode, toNode);
        });

        // Draw active linking thread
        if (linkingFromIdRef.current) {
          const fromNode = nodesRef.current.find(n => n.id === linkingFromIdRef.current);
          if (fromNode) {
            const parallax = 0.5 + ((fromNode.z + 4000) / 8000);
            const x1 = ((fromNode.x - cameraOffset.current.x * parallax) * s) + centerX;
            const y1 = ((fromNode.y - cameraOffset.current.y * parallax) * s) + centerY;
            
            const x2 = mousePosRef.current.x;
            const y2 = mousePosRef.current.y;
            
            ctx.shadowBlur = 20;
            ctx.shadowColor = 'white';
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
            ctx.lineWidth = 2 * s;
            ctx.setLineDash([5, 5]);
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();
            ctx.setLineDash([]);
          }
        }

        ctx.restore();
      }

      if (progress.current < 1) {
        progress.current += 0.0015;
      }

      particles.current.forEach(p => {
        const drift = Math.sin(time + p.phase) * 2;
        const targetX = p.tx + (p.tx / (sphereRadius || 1)) * drift;
        const targetY = p.ty + (p.ty / (sphereRadius || 1)) * drift;
        const targetZ = p.tz + (p.tz / (sphereRadius || 1)) * drift;

        const lerpSpeed = 0.02;
        p.x = p.x + (targetX - p.x) * lerpSpeed;
        p.y = p.y + (targetY - p.y) * lerpSpeed;
        p.z = p.z + (targetZ - p.z) * lerpSpeed;

        // Interpolate colors
        p.color.r += (p.targetColor.r - p.color.r) * 0.01;
        p.color.g += (p.targetColor.g - p.color.g) * 0.01;
        p.color.b += (p.targetColor.b - p.color.b) * 0.01;
        p.color.a += (p.targetColor.a - p.color.a) * 0.01;

        // Apply 3D Rotation to coordinates
        const cosY = Math.cos(rotation.current.y);
        const sinY = Math.sin(rotation.current.y);
        const rx = p.x * cosY - p.z * sinY;
        const rz = p.x * sinY + p.z * cosY;

        // Unified 2D Parallax Projection
        // Map Z to parallax depth (0.5 to 1.5)
        const parallax = 0.5 + ((rz + 4000) / 8000);
        const s = scale.get();
        const finalX = (rx - cameraOffset.current.x * parallax) * s;
        const finalY = (p.y - cameraOffset.current.y * parallax) * s;
        
        const px = finalX + centerX;
        const py = finalY + centerY;
        const pSize = p.size * parallax * s;
        const pAlpha = Math.min(parallax * 0.7, 1);

        if (px > -10 && px < dimensions.width + 10 && py > -10 && py < dimensions.height + 10) {
          ctx.globalAlpha = pAlpha;
          const r = Math.round(p.color.r);
          const g = Math.round(p.color.g);
          const b = Math.round(p.color.b);
          ctx.fillStyle = `rgba(${r},${g},${b},${p.color.a})`;
          const size = Math.max(1, pSize);
          ctx.fillRect(px - size / 2, py - size / 2, size, size);
        }
      });

      // UI Hint
      if (phase === 'space' && !hasInteracted) {
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = 'white';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Листайте, чтобы перемещаться в космосе', centerX, dimensions.height - 40);
      }

      animationFrameId = requestAnimationFrame(render);
    };

    render();
    return () => cancelAnimationFrame(animationFrameId);
  }, [dimensions, sphereRadius, phase, hasInteracted]);

  const triggerAddNode = (parentId?: string, direction: Direction = 'descendant') => {
    setPendingNode({ parentId, direction });
    setModalStep('addNodeName');
    setInputValue('');
  };

  const confirmAddNode = (name: string) => {
    if (!pendingNode) return;
    
    setNodes(prev => {
      const parent = prev.find(n => n.id === pendingNode.parentId);
      
      // Randomize distances (more compact)
      let verticalDist = 200 + Math.random() * 150; // 200 to 350
      let horizontalSpread = 80 + Math.random() * 70; // 80 to 150
      const depthSpread = 50 + Math.random() * 100; // 50 to 150

      let nx = parent ? parent.x + (Math.random() - 0.5) * horizontalSpread : 0;
      let ny = 0;
      let nType: any = 'descendant';

      if (parent) {
        if (pendingNode.direction === 'ancestor') {
          ny = parent.y - verticalDist;
          nType = 'ancestor';
        } else if (pendingNode.direction === 'descendant') {
          ny = parent.y + verticalDist;
          nType = 'descendant';
        } else if (pendingNode.direction === 'sibling-left') {
          nx = parent.x - (250 + Math.random() * 100);
          ny = parent.y + (Math.random() - 0.5) * 50;
          nType = 'sibling';
        } else if (pendingNode.direction === 'sibling-right') {
          nx = parent.x + (250 + Math.random() * 100);
          ny = parent.y + (Math.random() - 0.5) * 50;
          nType = 'sibling';
        }
      }

      const newNode: Node = {
        id: Math.random().toString(36).substr(2, 9),
        label: name,
        x: nx,
        y: ny,
        z: parent ? parent.z + (Math.random() - 0.5) * depthSpread : 0,
        type: pendingNode.parentId ? nType : 'user',
        createdAt: Date.now(),
        birthDate: '',
        profession: '',
        bio: ''
      };

      if (pendingNode.parentId) {
        if (pendingNode.direction === 'sibling-left' || pendingNode.direction === 'sibling-right') {
          if (parent?.parentId) newNode.parentId = parent.parentId;
        } else {
          newNode.parentId = pendingNode.parentId;
        }
      }
      
      const updated = [...prev, newNode];
      nodesRef.current = updated;
      return updated;
    });
    
    setModalStep('none');
    setPendingNode(null);
    if (!hasInteracted) setHasInteracted(true);
  };

  const addInitialNode = (name: string) => {
    const newNode: Node = {
      id: 'origin',
      label: name,
      x: 0,
      y: 0,
      z: 0,
      type: 'user',
      createdAt: Date.now(),
      birthDate: '',
      profession: '',
      bio: ''
    };
    const updated = [newNode];
    setNodes(updated);
    nodesRef.current = updated;
  };

  const handleNodeClick = React.useCallback((node: Node, e?: React.MouseEvent) => {
    if (isCtrlPressedRef.current) {
      setSelectedNodeIds(prev => {
        const next = new Set(prev);
        if (next.has(node.id)) {
          next.delete(node.id);
        } else {
          next.add(node.id);
        }
        return next;
      });
      return;
    }

    setSelectedNodeId(node.id);
    setEditDetails({
      label: node.label,
      birthDate: node.birthDate || '',
      profession: node.profession || '',
      bio: node.bio || ''
    });
    setModalStep('nodeDetails');
  }, []);

  const saveNodeDetails = React.useCallback(() => {
    if (!selectedNodeId) return;
    setNodes(prev => {
      const updated = prev.map(n => 
        n.id === selectedNodeId 
          ? { ...n, ...editDetails } 
          : n
      );
      nodesRef.current = updated;
      return updated;
    });
    setModalStep('none');
    setSelectedNodeId(null);
  }, [selectedNodeId, editDetails]);

  const deleteNode = React.useCallback(() => {
    if (!selectedNodeId) return;
    setNodes(prev => {
      const updated = prev
        .filter(n => n.id !== selectedNodeId)
        .map(n => n.parentId === selectedNodeId ? { ...n, parentId: undefined } : n);
      nodesRef.current = updated;
      return updated;
    });
    setLinks(prev => {
      const updated = prev.filter(l => l.from !== selectedNodeId && l.to !== selectedNodeId);
      linksRef.current = updated;
      return updated;
    });
    setModalStep('none');
    setSelectedNodeId(null);
  }, [selectedNodeId]);

  const autoLayoutSelectedNodes = React.useCallback(() => {
    if (selectedNodeIds.size < 2) return;

    setNodes(prev => {
      const selectedNodes = prev.filter(n => selectedNodeIds.has(n.id));
      if (selectedNodes.length < 2) return prev;

      // Sort to maintain some predictable order (by label or type)
      const sorted = [...selectedNodes].sort((a, b) => {
        if (a.type !== b.type) return a.type.localeCompare(b.type);
        return a.label.localeCompare(b.label);
      });
      
      const count = selectedNodes.length;
      // Calculate optimal grid columns
      const cols = Math.ceil(Math.sqrt(count));
      const spacingX = 220;
      const spacingY = 220;

      // Find center of current selection to keep layout localized
      const avgX = selectedNodes.reduce((sum, n) => sum + n.x, 0) / count;
      const avgY = selectedNodes.reduce((sum, n) => sum + n.y, 0) / count;
      
      const gridWidth = (cols - 1) * spacingX;
      const rows = Math.ceil(count / cols);
      const gridHeight = (rows - 1) * spacingY;
      
      const startX = avgX - gridWidth / 2;
      const startY = avgY - gridHeight / 2;

      const updated = prev.map(n => {
        if (selectedNodeIds.has(n.id)) {
          const index = sorted.findIndex(s => s.id === n.id);
          const row = Math.floor(index / cols);
          const col = index % cols;
          
          return {
            ...n,
            x: startX + col * spacingX,
            y: startY + row * spacingY,
            // Add slight Z variation for better parallax depth feel
            z: (n.z || 0) + (Math.random() - 0.5) * 50 
          };
        }
        return n;
      });

      nodesRef.current = updated;
      return updated;
    });
  }, [selectedNodeIds]);

  const searchResults = React.useMemo(() => {
    if (!searchQuery.trim()) return [];
    return nodes.filter(n => n.label.toLowerCase().includes(searchQuery.toLowerCase()));
  }, [nodes, searchQuery]);

  const handleSearchResultClick = (node: Node) => {
    targetCameraOffset.current = { x: node.x, y: node.y, z: 0 };
    triggerMoving();
    setSearchQuery('');
    setIsSearchOpen(false);
    setSelectedNodeId(node.id); // Also select to highlight
  };

  const [isMoving, setIsMoving] = useState(false);
  const movingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const triggerMoving = () => {
    setIsMoving(true);
    if (movingTimeoutRef.current) clearTimeout(movingTimeoutRef.current);
    movingTimeoutRef.current = setTimeout(() => setIsMoving(false), 2000);
  };

  const [showInfo, setShowInfo] = useState(false);

  const handleLogin = async (mode: 'login' | 'register' = 'login') => {
    if (isAuthenticating) return;
    setIsAuthenticating(true);
    try {
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);
      
      // Check if user has any tree in Firestore
      const q = query(
        collection(db, 'trees'),
        where('ownerId', '==', result.user.uid),
        limit(1)
      );
      const treeSnapshot = await getDocsFromServer(q);
      const hasData = !treeSnapshot.empty;

      if (mode === 'register' || !hasData) {
        // Clear local state for fresh start if registering or no data
        setNodes([]);
        nodesRef.current = [];
        setLinks([]);
        linksRef.current = [];
        setTypeName('');
        setUserName('');
        setModalStep('typeName');
      } else {
        // Login mode - data will be loaded by the onSnapshot useEffect
        setModalStep('none');
      }
    } catch (error: any) {
      if (error.code === 'auth/popup-closed-by-user') {
        console.log("User closed the popup");
      } else if (error.code === 'auth/cancelled-popup-request') {
        console.log("Popup request cancelled due to a newer request");
      } else {
        console.error("Login error", error);
      }
    } finally {
      setIsAuthenticating(false);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setNodes([]);
      nodesRef.current = [];
      setTypeName('');
      setUserName('');
      setTreeId(null);
      setModalStep('auth');
    } catch (error) {
      console.error("Logout error", error);
    }
  };

  const handleCanvasDoubleClick = (e: React.MouseEvent) => {
    if (phase !== 'space') return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const centerX = dimensions.width / 2;
    const centerY = dimensions.height / 2;
    const s = scale.get();

    // Find if we clicked near any link
    let linkToDeleteId = null;
    
    for (const link of links) {
      const n1 = nodes.find(n => n.id === link.from);
      const n2 = nodes.find(n => n.id === link.to);
      if (!n1 || !n2) continue;

      const p1 = 0.5 + ((n1.z + 4000) / 8000);
      const x1 = ((n1.x - cameraOffset.current.x * p1) * s) + centerX;
      const y1 = ((n1.y - cameraOffset.current.y * p1) * s) + centerY;

      const p2 = 0.5 + ((n2.z + 4000) / 8000);
      const x2 = ((n2.x - cameraOffset.current.x * p2) * s) + centerX;
      const y2 = ((n2.y - cameraOffset.current.y * p2) * s) + centerY;

      // Distance from point to line segment
      const A = mx - x1;
      const B = my - y1;
      const C = x2 - x1;
      const D = y2 - y1;

      const dot = A * C + B * D;
      const lenSq = C * C + D * D;
      let param = -1;
      if (lenSq !== 0) param = dot / lenSq;

      let xx, yy;

      if (param < 0) {
        xx = x1;
        yy = y1;
      } else if (param > 1) {
        xx = x2;
        yy = y2;
      } else {
        xx = x1 + param * C;
        yy = y1 + param * D;
      }

      const dx = mx - xx;
      const dy = my - yy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < 15) { // 15px threshold
        linkToDeleteId = link.id;
        break;
      }
    }

    if (linkToDeleteId) {
      setLinks(prev => {
        const updated = prev.filter(l => l.id !== linkToDeleteId);
        linksRef.current = updated;
        return updated;
      });
    }
  };

  return (
    <ErrorBoundary>
      <div className="fixed inset-0 bg-black overflow-hidden touch-none select-none font-sans text-white">
        <CustomCursor isSelectionMode={isCtrlPressed && isEditMode} />
        <canvas
          ref={canvasRef}
          width={dimensions.width}
          height={dimensions.height}
          onDoubleClick={handleCanvasDoubleClick}
          className="block"
        />

        {/* Intro Overlay */}
        {phase !== 'space' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none gap-8">
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="text-center"
            >
              <h1 className="text-4xl font-light tracking-[0.5em] uppercase text-white/80">
                Cosmic Type
              </h1>
            </motion.div>
            
            {phase === 'assembling' && (
              <motion.button
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                onClick={() => setPhase('loading')}
                className="pointer-events-auto px-6 py-2 border border-white/20 rounded-full text-[10px] uppercase tracking-[0.3em] text-white/40 hover:text-white hover:border-white/50 transition-all"
              >
                Skip Intro
              </motion.button>
            )}
          </div>
        )}

        {/* Modals */}
        <AnimatePresence>
          {modalStep === 'auth' && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm z-[2000]">
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="bg-zinc-900/80 border border-white/10 p-8 rounded-2xl w-full max-w-md shadow-2xl text-center"
              >
                <h2 className="text-2xl font-light mb-2 tracking-wider uppercase">Welcome to Cosmo Type</h2>
                <p className="text-white/40 text-sm mb-8 font-light">Choose how you want to proceed</p>
                
                <div className="space-y-4">
                  <button
                    disabled={isAuthenticating}
                    onClick={() => handleLogin('login')}
                    className={`w-full py-4 bg-white text-black rounded-xl font-bold uppercase tracking-widest hover:bg-white/90 transition-all flex items-center justify-center gap-3 ${isAuthenticating ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    {isAuthenticating ? <div className="w-5 h-5 border-2 border-black/20 border-t-black rounded-full animate-spin" /> : <LogIn size={18} />} 
                    {isAuthenticating ? 'Connecting...' : 'Login'}
                  </button>
                  
                  <button
                    disabled={isAuthenticating}
                    onClick={() => handleLogin('register')}
                    className={`w-full py-4 bg-white/5 text-white border border-white/10 rounded-xl font-bold uppercase tracking-widest hover:bg-white/10 transition-all flex items-center justify-center gap-3 ${isAuthenticating ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    <Edit3 size={18} /> Register
                  </button>

                  <div className="pt-4 border-t border-white/5">
                    <button
                      onClick={() => setModalStep('none')}
                      className="text-white/30 text-xs uppercase tracking-widest hover:text-white transition-colors"
                    >
                      Continue as Guest
                    </button>
                  </div>
                </div>
              </motion.div>
            </div>
          )}

          {modalStep === 'typeName' && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm z-[2000]">
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="bg-zinc-900/80 border border-white/10 p-8 rounded-2xl w-full max-w-md shadow-2xl"
              >
                <h2 className="text-xl font-light mb-6 tracking-wider">GIVE A NAME TO THE TYPE</h2>
                <input
                  autoFocus
                  type="text"
                  placeholder="Type name..."
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-lg p-3 mb-6 focus:outline-none focus:border-white/30 transition-colors text-white"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && inputValue) {
                      setTypeName(inputValue);
                      setInputValue('');
                      if (nodes.length > 0) {
                        setModalStep('none');
                      } else {
                        setModalStep('userName');
                      }
                    }
                  }}
                />
                <button
                  onClick={() => {
                    if (inputValue) {
                      setTypeName(inputValue);
                      setInputValue('');
                      if (nodes.length > 0) {
                        setModalStep('none');
                      } else {
                        setModalStep('userName');
                      }
                    }
                  }}
                  className="w-full py-3 bg-white text-black rounded-lg font-medium hover:bg-white/90 transition-colors"
                >
                  {nodes.length > 0 ? 'Save' : 'Continue'}
                </button>
              </motion.div>
            </div>
          )}

          {modalStep === 'userName' && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm z-[2000]">
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="bg-zinc-900/80 border border-white/10 p-8 rounded-2xl w-full max-w-md shadow-2xl"
              >
                <h2 className="text-xl font-light mb-6 tracking-wider">ENTER YOUR NAME AND SURNAME</h2>
                <input
                  autoFocus
                  type="text"
                  placeholder="Name and Surname..."
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-lg p-3 mb-6 focus:outline-none focus:border-white/30 transition-colors text-white"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && inputValue) {
                      setUserName(inputValue);
                      setInputValue('');
                      setModalStep('none');
                      addInitialNode(inputValue);
                    }
                  }}
                />
                <button
                  onClick={() => {
                    if (inputValue) {
                      setUserName(inputValue);
                      setInputValue('');
                      setModalStep('none');
                      addInitialNode(inputValue);
                    }
                  }}
                  className="w-full py-3 bg-white text-black rounded-lg font-medium hover:bg-white/90 transition-colors"
                >
                  Start Journey
                </button>
              </motion.div>
            </div>
          )}
          {modalStep === 'addNodeName' && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm z-[2000]">
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="bg-zinc-900/80 border border-white/10 p-8 rounded-2xl w-full max-w-md shadow-2xl"
              >
                <h2 className="text-xl font-light mb-6 tracking-wider uppercase">
                  Name your {pendingNode?.direction}
                </h2>
                <input
                  autoFocus
                  type="text"
                  placeholder="Enter name..."
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-lg p-3 mb-6 focus:outline-none focus:border-white/30 transition-colors text-white"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && inputValue) {
                      confirmAddNode(inputValue);
                    }
                  }}
                />
                <div className="flex gap-3">
                  <button
                    onClick={() => {
                      setModalStep('none');
                      setPendingNode(null);
                    }}
                    className="flex-1 py-3 bg-white/5 text-white/50 rounded-lg font-medium hover:bg-white/10 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      if (inputValue) {
                        confirmAddNode(inputValue);
                      }
                    }}
                    className="flex-2 py-3 bg-white text-black rounded-lg font-medium hover:bg-white/90 transition-colors px-8"
                  >
                    Add
                  </button>
                </div>
              </motion.div>
            </div>
          )}

          {showInfo && (
            <div className="absolute inset-y-0 right-0 w-full max-w-sm z-[2000] pointer-events-none flex justify-end">
              <motion.div
                initial={{ x: '100%' }}
                animate={{ x: 0 }}
                exit={{ x: '100%' }}
                transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                className="bg-zinc-900/95 border-l border-white/10 h-full w-full shadow-2xl backdrop-blur-3xl pointer-events-auto flex flex-col"
              >
                <div className="p-8 overflow-y-auto flex-1">
                  <div className="flex justify-between items-center mb-10">
                    <h2 className="text-xl font-light tracking-[0.3em] uppercase">
                      Space Info
                    </h2>
                    <button 
                      onClick={() => setShowInfo(false)}
                      className="p-2 hover:bg-white/10 rounded-full transition-colors text-white/40 hover:text-white"
                    >
                      <Plus size={20} className="rotate-45" />
                    </button>
                  </div>

                  <div className="space-y-8">
                    <section>
                      <h3 className="text-[10px] uppercase tracking-[0.4em] text-white/30 mb-4">Statistics</h3>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="bg-white/5 p-4 rounded-xl border border-white/5">
                          <div className="text-2xl font-light">{nodes.length}</div>
                          <div className="text-[9px] uppercase tracking-widest text-white/20 mt-1">Nodes</div>
                        </div>
                        <div className="bg-white/5 p-4 rounded-xl border border-white/5">
                          <div className="text-2xl font-light">{links.length}</div>
                          <div className="text-[9px] uppercase tracking-widest text-white/20 mt-1">Links</div>
                        </div>
                      </div>
                    </section>

                    <section>
                      <h3 className="text-[10px] uppercase tracking-[0.4em] text-white/30 mb-4">Controls</h3>
                      <ul className="space-y-3 text-xs text-white/60 font-light leading-relaxed">
                        <li className="flex justify-between border-b border-white/5 pb-2">
                          <span>Pan</span>
                          <span className="text-white/30">Drag Background</span>
                        </li>
                        <li className="flex justify-between border-b border-white/5 pb-2">
                          <span>Zoom</span>
                          <span className="text-white/30">Wheel / Buttons</span>
                        </li>
                        <li className="flex justify-between border-b border-white/5 pb-2">
                          <span>Edit Node</span>
                          <span className="text-white/30">Click Card</span>
                        </li>
                        <li className="flex justify-between border-b border-white/5 pb-2">
                          <span>Create Link</span>
                          <span className="text-white/30">Drag Handle (Edit)</span>
                        </li>
                        <li className="flex justify-between border-b border-white/5 pb-2">
                          <span>Delete Link</span>
                          <span className="text-white/30">Double Click Line</span>
                        </li>
                        <li className="flex justify-between border-b border-white/5 pb-2">
                          <span>Multi-Select</span>
                          <span className="text-white/30">CTRL + Drag / Click</span>
                        </li>
                        <li className="flex justify-between border-b border-white/5 pb-2">
                          <span>Auto Layout</span>
                          <span className="text-white/30">Select 2+ Nodes</span>
                        </li>
                      </ul>
                    </section>

                    <section className="bg-white/5 p-6 rounded-2xl border border-white/10">
                      <h3 className="text-[10px] uppercase tracking-[0.4em] text-white/30 mb-3">Cloud Sync</h3>
                      <p className="text-xs text-white/50 leading-relaxed mb-4">
                        Sign in to synchronize your space across devices and ensure your data is backed up in the cosmic void.
                      </p>
                      {!user && (
                        <button 
                          onClick={() => setModalStep('auth')}
                          className="w-full py-3 bg-white text-black rounded-lg text-xs font-bold uppercase tracking-widest hover:bg-white/90 transition-all"
                        >
                          Sign In Now
                        </button>
                      )}
                    </section>
                  </div>
                </div>
                
                <div className="p-8 text-center border-t border-white/5">
                  <div className="text-[9px] text-white/10 tracking-[0.5em] uppercase">
                    Cosmic Type v1.0
                  </div>
                </div>
              </motion.div>
            </div>
          )}

          {modalStep === 'nodeDetails' && (
            <div className="absolute inset-y-0 right-0 w-full max-w-md z-[2000] pointer-events-none flex justify-end">
              <motion.div
                initial={{ x: '100%' }}
                animate={{ x: 0 }}
                exit={{ x: '100%' }}
                transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                className="bg-zinc-900/90 border-l border-white/10 h-full w-full shadow-2xl backdrop-blur-2xl pointer-events-auto flex flex-col"
              >
                <div className="p-8 overflow-y-auto flex-1">
                  <div className="flex justify-between items-center mb-8">
                    <h2 className="text-xl font-light tracking-wider uppercase">
                      Node Details
                    </h2>
                    <button 
                      onClick={() => {
                        setModalStep('none');
                        setSelectedNodeId(null);
                      }}
                      className="p-2 hover:bg-white/10 rounded-full transition-colors text-white/40 hover:text-white"
                    >
                      <Plus size={20} className="rotate-45" />
                    </button>
                  </div>

                  <div className="space-y-6">
                    <div>
                      <label className="text-[10px] uppercase tracking-widest text-white/40 block mb-2 ml-1">Name</label>
                      <input
                        type="text"
                        value={editDetails.label}
                        onChange={(e) => setEditDetails(prev => ({ ...prev, label: e.target.value }))}
                        className="w-full bg-white/5 border border-white/10 rounded-xl p-4 focus:outline-none focus:border-white/30 transition-colors text-white text-lg font-light tracking-wide"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="text-[10px] uppercase tracking-widest text-white/40 block mb-2 ml-1">Birth Date</label>
                        <input
                          type="text"
                          placeholder="e.g. 1990-01-01"
                          value={editDetails.birthDate}
                          onChange={(e) => setEditDetails(prev => ({ ...prev, birthDate: e.target.value }))}
                          className="w-full bg-white/5 border border-white/10 rounded-xl p-4 focus:outline-none focus:border-white/30 transition-colors text-white"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] uppercase tracking-widest text-white/40 block mb-2 ml-1">Profession</label>
                        <input
                          type="text"
                          placeholder="e.g. Architect"
                          value={editDetails.profession}
                          onChange={(e) => setEditDetails(prev => ({ ...prev, profession: e.target.value }))}
                          className="w-full bg-white/5 border border-white/10 rounded-xl p-4 focus:outline-none focus:border-white/30 transition-colors text-white"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="text-[10px] uppercase tracking-widest text-white/40 block mb-2 ml-1">Information</label>
                      <textarea
                        rows={6}
                        placeholder="Tell more about this person..."
                        value={editDetails.bio}
                        onChange={(e) => setEditDetails(prev => ({ ...prev, bio: e.target.value }))}
                        className="w-full bg-white/5 border border-white/10 rounded-xl p-4 focus:outline-none focus:border-white/30 transition-colors text-white resize-none font-light leading-relaxed"
                      />
                    </div>
                  </div>
                </div>

                <div className="p-8 border-t border-white/10 bg-black/20">
                  <div className="flex gap-3">
                    {nodes.find(n => n.id === selectedNodeId)?.type !== 'user' && (
                      <button
                        onClick={deleteNode}
                        className="flex-1 py-4 bg-red-500/10 text-red-500 border border-red-500/20 rounded-xl font-medium hover:bg-red-500/20 transition-colors text-sm uppercase tracking-widest"
                      >
                        Delete
                      </button>
                    )}
                    <button
                      onClick={saveNodeDetails}
                      className="flex-[2] py-4 bg-white text-black rounded-xl font-medium hover:bg-white/90 transition-colors px-8 text-sm uppercase tracking-widest"
                    >
                      Save Changes
                    </button>
                  </div>
                  <div className="mt-4 text-center">
                    <div className="text-[9px] text-white/10 tracking-[0.3em] uppercase">
                      Node ID: {selectedNodeId}
                    </div>
                  </div>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Main UI */}
        {(modalStep === 'none' || modalStep === 'nodeDetails') && (phase === 'space' || phase === 'loading') && (
          <>
            {/* Search UI */}
            <div className="absolute top-6 left-6 flex items-start gap-4 z-[1000]">
              <div className="flex flex-col gap-2">
                <button 
                  onClick={() => setIsSearchOpen(!isSearchOpen)}
                  className={`p-3 rounded-full border transition-all backdrop-blur-md shadow-xl ${
                    isSearchOpen 
                      ? 'bg-white text-black border-white' 
                      : 'bg-zinc-900/80 border-white/10 text-white/60 hover:text-white hover:bg-white/10'
                  }`}
                  title="Search Nodes"
                >
                  <Search size={18} />
                </button>
              </div>

              <AnimatePresence>
                {isSearchOpen && (
                  <motion.div
                    initial={{ opacity: 0, x: -20, scale: 0.95 }}
                    animate={{ opacity: 1, x: 0, scale: 1 }}
                    exit={{ opacity: 0, x: -20, scale: 0.95 }}
                    className="relative w-72"
                  >
                    <div className="bg-zinc-900/90 border border-white/10 rounded-2xl overflow-hidden backdrop-blur-xl shadow-2xl">
                      <div className="p-4 flex items-center gap-3 border-b border-white/5">
                        <Search size={14} className="text-white/30" />
                        <input 
                          autoFocus
                          type="text"
                          placeholder="Find relatives..."
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          className="bg-transparent border-none outline-none text-sm text-white w-full font-light"
                        />
                        {searchQuery && (
                          <button onClick={() => setSearchQuery('')} className="text-white/20 hover:text-white transition-colors">
                            <X size={14} />
                          </button>
                        )}
                      </div>
                      
                      {searchResults.length > 0 && (
                        <div className="max-h-64 overflow-y-auto p-2 space-y-1">
                          {searchResults.map(result => (
                            <button
                              key={result.id}
                              onClick={() => handleSearchResultClick(result)}
                              className="w-full p-3 rounded-xl hover:bg-white/5 text-left transition-all border border-transparent hover:border-white/5 flex items-center justify-between group"
                            >
                              <div>
                                <div className="text-sm font-light text-white/90 group-hover:text-white">{result.label}</div>
                                <div className="text-[9px] uppercase tracking-widest text-white/20">{result.type}</div>
                              </div>
                              <Target size={12} className="text-white/10 group-hover:text-white/40" />
                            </button>
                          ))}
                        </div>
                      )}

                      {searchQuery && searchResults.length === 0 && (
                        <div className="p-8 text-center text-[10px] uppercase tracking-[0.2em] text-white/20 font-light">
                          No souls found in the void
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Auth UI */}
            <div className="absolute top-6 right-6 flex items-center gap-4 z-[1000]">
              {/* Edit Mode Toggle */}
              <button
                onClick={() => setIsEditMode(!isEditMode)}
                className={`flex items-center gap-2 px-4 py-2 rounded-full border transition-all ${
                  isEditMode 
                    ? 'bg-blue-500 border-blue-400 text-white shadow-[0_0_20px_rgba(59,130,246,0.5)]' 
                    : 'bg-white/5 border-white/10 text-white/60 hover:bg-white/10'
                }`}
              >
                {isEditMode ? <Move size={16} /> : <Edit3 size={16} />}
                <span className="text-[10px] uppercase tracking-widest font-medium">
                  {isEditMode ? 'Edit Mode' : 'View Mode'}
                </span>
              </button>

              <div className="flex flex-col items-end">
                {isSaving ? (
                  <div className="flex items-center gap-2 text-[10px] text-white/40 uppercase tracking-widest">
                    <Save size={12} className="animate-pulse" /> Saving...
                  </div>
                ) : lastSaved ? (
                  <div className="text-[10px] text-white/20 uppercase tracking-widest">
                    Saved {new Date(lastSaved).toLocaleTimeString()}
                  </div>
                ) : null}
                {!isOnline && (
                  <div className="flex items-center gap-2 text-[10px] text-red-400 uppercase tracking-widest">
                    <CloudOff size={12} /> Offline
                  </div>
                )}
              </div>
              
              {user ? (
                <div className="flex items-center gap-3 bg-white/5 border border-white/10 p-1 pl-4 rounded-full backdrop-blur-md">
                  <span className="text-xs font-light tracking-wider text-white/60">{user.displayName}</span>
                  <button 
                    onClick={handleLogout}
                    className="p-2 hover:bg-white/10 rounded-full transition-colors text-white/40 hover:text-white"
                  >
                    <LogOut size={16} />
                  </button>
                  {user.photoURL && (
                    <img src={user.photoURL} alt="" className="w-8 h-8 rounded-full border border-white/20" referrerPolicy="no-referrer" />
                  )}
                </div>
              ) : (
                <button 
                  onClick={() => setModalStep('auth')}
                  className="flex items-center gap-2 px-6 py-2 bg-white text-black rounded-full text-sm font-medium hover:bg-white/90 transition-colors shadow-xl"
                >
                  <LogIn size={16} /> Sign In to Save
                </button>
              )}

              {/* Info Button */}
              <button
                onClick={() => setShowInfo(!showInfo)}
                className={`p-2 rounded-full border transition-all ${
                  showInfo 
                    ? 'bg-white border-white text-black shadow-[0_0_20px_rgba(255,255,255,0.5)]' 
                    : 'bg-white/5 border-white/10 text-white/40 hover:bg-white/10 hover:text-white'
                }`}
                title="Space Information"
              >
                <Plus size={20} className={`transition-transform duration-300 ${showInfo ? 'rotate-45' : ''}`} />
              </button>
            </div>

            <SpatialElement 
              x={0} y={-1500} z={-2000} 
              cameraX={cameraX} cameraY={cameraY} scale={scale}
              dimensions={dimensions}
            >
              <div className="text-center space-y-1 pointer-events-none">
                <h1 
                  className="text-7xl font-light tracking-[0.8em] uppercase whitespace-nowrap opacity-10 cursor-pointer pointer-events-auto hover:opacity-30 transition-opacity"
                  onClick={() => {
                    setInputValue(typeName);
                    setModalStep('typeName');
                  }}
                >
                  {typeName}
                </h1>
              </div>
            </SpatialElement>

            {/* Render Nodes as Cards */}
            {nodes.map(node => (
              <NodeCard 
                key={node.id} 
                node={node} 
                cameraX={cameraX} 
                cameraY={cameraY} 
                scale={scale}
                dimensions={dimensions}
                onClick={(e: any) => handleNodeClick(node, e)}
                onLinkStart={onLinkStart}
                onLinkEnter={onLinkEnter}
                onLinkLeave={onLinkLeave}
                onDragStart={onDragStart}
                isLinkingTarget={linkingTargetId === node.id}
                isEditMode={isEditMode}
                isSelected={selectedNodeIds.has(node.id)}
                isHighlighted={searchQuery && node.label.toLowerCase().includes(searchQuery.toLowerCase())}
              />
            ))}

            {/* Render Ghost Cards for leaf nodes */}
            {isEditMode && nodes.map(node => {
              const hasAncestor = nodes.some(n => n.parentId === node.id && n.type === 'ancestor');
              const hasDescendant = nodes.some(n => n.parentId === node.id && n.type === 'descendant');
              const isTopMost = node.type === 'ancestor' && !nodes.some(n => n.parentId === node.id);
              const isBottomMost = node.type === 'descendant' && !nodes.some(n => n.parentId === node.id);
              const isUser = node.type === 'user';

              const ghosts = [];

              const isSlotOccupied = (x: number, y: number, z: number) => {
                return nodes.some(n => {
                  const dx = n.x - x;
                  const dy = n.y - y;
                  const dz = n.z - z;
                  const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
                  return dist < 100; // Threshold for "occupied"
                });
              };

              if (((isUser && !hasAncestor) || isTopMost) && !isSlotOccupied(node.x, node.y - 160, node.z)) {
                ghosts.push(
                  <GhostCard 
                    key={`ghost-anc-${node.id}`}
                    x={node.x} y={node.y - 160} z={node.z}
                    cameraX={cameraX} cameraY={cameraY} scale={scale}
                    dimensions={dimensions}
                    onClick={() => triggerAddNode(node.id, 'ancestor')}
                  />
                );
              }

              if (((isUser && !hasDescendant) || isBottomMost) && !isSlotOccupied(node.x, node.y + 160, node.z)) {
                ghosts.push(
                  <GhostCard 
                    key={`ghost-desc-${node.id}`}
                    x={node.x} y={node.y + 160} z={node.z}
                    cameraX={cameraX} cameraY={cameraY} scale={scale}
                    dimensions={dimensions}
                    onClick={() => triggerAddNode(node.id, 'descendant')}
                  />
                );
              }

              // Sibling Slots
              if (!isSlotOccupied(node.x - 200, node.y, node.z)) {
                ghosts.push(
                  <GhostCard 
                    key={`ghost-sib-l-${node.id}`}
                    x={node.x - 200} y={node.y} z={node.z} 
                    cameraX={cameraX} cameraY={cameraY} scale={scale}
                    dimensions={dimensions} 
                    onClick={() => triggerAddNode(node.id, 'sibling-left')}
                  />
                );
              }
              
              if (!isSlotOccupied(node.x + 200, node.y, node.z)) {
                ghosts.push(
                  <GhostCard 
                    key={`ghost-sib-r-${node.id}`}
                    x={node.x + 200} y={node.y} z={node.z} 
                    cameraX={cameraX} cameraY={cameraY} scale={scale}
                    dimensions={dimensions} 
                    onClick={() => triggerAddNode(node.id, 'sibling-right')}
                  />
                );
              }

              return ghosts;
            })}

            {/* Selection Box */}
            {selectionBox && (
              <div 
                className="absolute border border-blue-500/50 bg-blue-500/10 z-[1500] pointer-events-none"
                style={{
                  left: Math.min(selectionBox.startX, selectionBox.endX),
                  top: Math.min(selectionBox.startY, selectionBox.endY),
                  width: Math.abs(selectionBox.startX - selectionBox.endX),
                  height: Math.abs(selectionBox.startY - selectionBox.endY)
                }}
              />
            )}

            {/* Navigator (Minimap) */}
            <AnimatePresence>
              {isMoving && (
                <motion.div
                  initial={{ opacity: 0, x: 20, scale: 0.95 }}
                  animate={{ opacity: 1, x: 0, scale: 1 }}
                  exit={{ opacity: 0, x: 20, scale: 0.95 }}
                  className="absolute bottom-6 right-24 z-[1000]"
                >
                  <Navigator 
                    nodes={nodes}
                    cameraX={cameraX}
                    cameraY={cameraY}
                    scale={scale}
                    dimensions={dimensions}
                    onJump={(x: number, y: number) => {
                      targetCameraOffset.current.x = x;
                      targetCameraOffset.current.y = y;
                      triggerMoving();
                      if (!hasInteracted) setHasInteracted(true);
                    }}
                  />
                </motion.div>
              )}
            </AnimatePresence>

            {/* Zoom & Center Controls */}
            <div className="absolute bottom-6 right-6 flex flex-col gap-2 z-[1000]">
              <AnimatePresence>
                {selectedNodeIds.size > 1 && isEditMode && (
                  <motion.button
                    initial={{ opacity: 0, scale: 0.8, x: 20 }}
                    animate={{ opacity: 1, scale: 1, x: 0 }}
                    exit={{ opacity: 0, scale: 0.8, x: 20 }}
                    onClick={autoLayoutSelectedNodes}
                    className="p-3 bg-blue-600 border border-blue-400 rounded-full hover:bg-blue-500 transition-all text-white backdrop-blur-md shadow-[0_0_20px_rgba(59,130,246,0.5)] mb-2"
                    title="Auto Layout Selected"
                  >
                    <Layout size={18} />
                  </motion.button>
                )}
              </AnimatePresence>

              <button 
                onClick={() => scale.set(Math.min(3, scale.get() + 0.2))}
                className="p-3 bg-zinc-900/80 border border-white/10 rounded-full hover:bg-white/10 transition-all text-white/60 hover:text-white backdrop-blur-md shadow-xl"
                title="Zoom In"
              >
                <Plus size={18} />
              </button>
              <button 
                onClick={() => {
                  targetCameraOffset.current.x = 0;
                  targetCameraOffset.current.y = 0;
                  scale.set(1);
                }}
                className="p-3 bg-zinc-900/80 border border-white/10 rounded-full hover:bg-white/10 transition-all text-white/60 hover:text-white backdrop-blur-md shadow-xl"
                title="Center View"
              >
                <Target size={18} />
              </button>
              <button 
                onClick={() => scale.set(Math.max(0.2, scale.get() - 0.2))}
                className="p-3 bg-zinc-900/80 border border-white/10 rounded-full hover:bg-white/10 transition-all text-white/60 hover:text-white backdrop-blur-md shadow-xl"
                title="Zoom Out"
              >
                <Minus size={18} />
              </button>
            </div>

            {/* Loading Screen */}
            {phase === 'loading' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-black z-[100]">
                <div className="relative w-24 h-24">
                  <motion.div 
                    animate={{ rotate: 360 }}
                    transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                    className="absolute inset-0 border-t-2 border-white/20 rounded-full"
                  />
                  <motion.div 
                    animate={{ rotate: -360 }}
                    transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
                    className="absolute inset-2 border-b-2 border-white/40 rounded-full"
                  />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-1 h-1 bg-white rounded-full animate-pulse shadow-[0_0_10px_white]" />
                  </div>
                </div>
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: [0.3, 0.6, 0.3] }}
                  transition={{ duration: 2, repeat: Infinity }}
                  className="mt-8 text-[10px] uppercase tracking-[0.4em] text-white/40"
                >
                  Synchronizing with the Void
                </motion.div>
              </div>
            )}
          </>
        )}
      </div>
    </ErrorBoundary>
  );
}
