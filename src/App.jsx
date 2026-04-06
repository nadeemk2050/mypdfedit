import React, { useState, useRef, useEffect } from 'react';
import {
  signInWithPopup,
  signOut,
  onAuthStateChanged
} from "firebase/auth";
import {
  doc,
  setDoc,
  getDoc,
  updateDoc,
  arrayUnion,
  arrayRemove
} from "firebase/firestore";
import { auth, googleProvider, db, storage } from './firebase';
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { Upload, Type, Eraser, Pipette, MousePointer2, Save, Undo, Check, X, Move, Bold, Italic, ChevronLeft, ChevronRight, FileText, Settings, Maximize, Pen, Image as ImageIcon, RotateCw, User, LogIn, LogOut, Trash2, FilePlus, ZoomIn, ZoomOut, Underline } from 'lucide-react';

function App() {
  const [pdfDoc, setPdfDoc] = useState(null);
  const [pageNum, setPageNum] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const [scale, setScale] = useState(2.0);
  const [zoom, setZoom] = useState(0.7);
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0, scrollTop: 0, scrollLeft: 0 });
  const containerRef = useRef(null);
  const [tool, setTool] = useState('cursor');
  const [color, setColor] = useState('#000000');
  const [brushSize, setBrushSize] = useState(3);
  const [annotations, setAnnotations] = useState([]);
  const [fileName, setFileName] = useState('document.pdf');
  const [libsLoaded, setLibsLoaded] = useState(false);
  const [canvasDimensions, setCanvasDimensions] = useState({ width: 0, height: 0 });
  const [isSaving, setIsSaving] = useState(false);
  const [pdfBytes, setPdfBytes] = useState(null); // Add this near other states
  const [isGrayscale, setIsGrayscale] = useState(false);
  const [deletedPages, setDeletedPages] = useState([]);
  const [extraPages, setExtraPages] = useState(0);
  const [pageBackgrounds, setPageBackgrounds] = useState({});

  // 100 = Original Quality (Vector). Below 100 = Compress (Image)
  const [saveQuality, setSaveQuality] = useState(100);

  // Add these with your other states
  const [pageOrder, setPageOrder] = useState([]);
  const [isReordering, setIsReordering] = useState(false); // To show/hide the reorder popup
  const [draggedPage, setDraggedPage] = useState(null); // To track which page is being dragged

  // Auth States
  const [user, setUser] = useState(null);
  const [savedImages, setSavedImages] = useState([]);
  const [showProfile, setShowProfile] = useState(false);

  const [textInput, setTextInput] = useState({
    x: 0, y: 0, width: 200, height: 40, text: '', isVisible: false,
    fontSize: 20, fontFamily: 'Arial', // Default Font
    isBold: false, isItalic: false, isUnderline: false, // 👈 Added isUnderline
    id: null, opacity: 1, rotation: 0
  });

  const [imageInput, setImageInput] = useState({
    x: 0, y: 0, width: 150, height: 150, image: null, src: null, isVisible: false, id: null, aspectRatio: 1,
    opacity: 1, rotation: 0
  });

  // Dragging/Resizing States
  const [activeDrag, setActiveDrag] = useState(null);
  const [activeResize, setActiveResize] = useState(null);

  const imageInputRef = useRef(null);

  const pdfCanvasRef = useRef(null);
  const overlayCanvasRef = useRef(null);
  const fileInputRef = useRef(null);
  const inputRef = useRef(null);
  const bgInputRef = useRef(null);

  // 2. Add this Handler for Uploading Background
  const handleBgUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      // Get the ID of the current page (works for normal or reordered/new pages)
      const actualPage = pageOrder[pageNum - 1] || pageNum;

      setPageBackgrounds(prev => ({
        ...prev,
        // Store Object with Source AND Opacity (Default 0.5)
        [actualPage]: { src: event.target.result, opacity: 0.5 }
      }));
    };
    reader.readAsDataURL(file);
    e.target.value = null; // Reset input
  };

  const [isDrawing, setIsDrawing] = useState(false);
  const [startPos, setStartPos] = useState({ x: 0, y: 0 });
  const [currentPath, setCurrentPath] = useState([]);

  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [resizeStart, setResizeStart] = useState({ w: 0, h: 0, x: 0, y: 0 });

  useEffect(() => {
    const loadLibraries = async () => {
      try {
        // Load PDF.js Main
        if (!window.pdfjsLib) {
          const script1 = document.createElement('script');
          script1.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
          script1.async = true;
          document.head.appendChild(script1);
          await new Promise(resolve => script1.onload = resolve);
        }

        // Load PDF.js Worker (Critical!)
        if (window.pdfjsLib) {
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        }

        // Load jsPDF
        if (!window.jspdf) {
          const script2 = document.createElement('script');
          script2.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
          script2.async = true;
          document.head.appendChild(script2);
          await new Promise(resolve => script2.onload = resolve);
        }

        // 4. NEW: pdf-lib (The Magic Library for Original Quality)
        if (!window.PDFLib) {
          const script3 = document.createElement('script');
          script3.src = 'https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js';
          script3.async = true;
          document.head.appendChild(script3);
          await new Promise(resolve => script3.onload = resolve);
        }

        console.log("Libraries Loaded!");
        setLibsLoaded(true);
      } catch (error) {
        console.error("Failed to load external libraries", error);
        // Fallback: Enable upload anyway so user sees error on click instead of dead button
        setLibsLoaded(true);
      }
    };
    loadLibraries();
  }, []);

  useEffect(() => {
    if (textInput.isVisible && inputRef.current && !activeDrag && !activeResize) {
      inputRef.current.focus();
    }
  }, [textInput.isVisible, activeDrag, activeResize]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        try {
          const docRef = doc(db, "users", currentUser.uid);
          const docSnap = await getDoc(docRef);
          if (docSnap.exists()) {
            setSavedImages(docSnap.data().images || []);
          } else {
            await setDoc(docRef, { images: [] });
            setSavedImages([]);
          }
        } catch (error) {
          console.error("Firestore initialization error:", error);
          if (error.message.includes('permission')) {
             console.warn("User profile data could not be loaded due to permissions. Check Firestore rules.");
          }
          setSavedImages([]);
        }
      } else {
        setSavedImages([]);
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    // Smart Responsive Scale: Fit PDF to screen width
    const updateScale = () => {
      if (window.innerWidth < 768) {
        // Mobile: Fit width (Assuming A4 width ~600px)
        const newScale = (window.innerWidth - 20) / 600;
        setScale(newScale);
      } else {
        // Desktop: High Quality
        setScale(2.0);
      }
    };

    updateScale(); // Run on load
    window.addEventListener('resize', updateScale); // Run on resize
    return () => window.removeEventListener('resize', updateScale);
  }, []);

  const handleLogin = async () => {
    try { await signInWithPopup(auth, googleProvider); }
    catch (error) { console.error("Login failed:", error); alert("Login failed"); }
  };

  const handleLogout = async () => {
    await signOut(auth);
    setShowProfile(false);
  };

  const handleProfileUpload = async (e) => {
    if (!user || !user.uid) return alert("Please Sign In properly to upload assets.");
    const file = e.target.files[0];
    if (!file) return;

    if (savedImages.length >= 10) return alert("Limit Reached! You have 10 images already.");

    // Check size (2MB limit for storage is reasonable, though we keep 1MB for safety)
    if (file.size > 1000000) return alert("Image is too big! Please keep it under 1MB.");

    try {
      setIsSaving(true);
      // 1. Storage Path: users/UID/ASSET_NAME_TIMESTAMP
      const storageRef = ref(storage, `users/${user.uid}/assets/${Date.now()}_${file.name}`);
      
      // 2. Upload to Storage
      const snapshot = await uploadBytes(storageRef, file);
      const downloadURL = await getDownloadURL(snapshot.ref);

      // 3. Save URL to Firestore
      const userRef = doc(db, "users", user.uid);
      await setDoc(userRef, { images: arrayUnion(downloadURL) }, { merge: true });
      
      setSavedImages(prev => [...prev, downloadURL]);
      alert("Success! Image saved to your assets.");
    } catch (error) {
      console.error("Upload failed:", error);
      if (error.code === 'storage/unauthorized' || error.message.includes('permission')) {
        alert("Permission Denied: Please check your Firebase Security Rules (Storage and Firestore).");
      } else {
        alert("Upload failed. Check console for details.");
      }
    } finally {
      setIsSaving(false);
    }
    e.target.value = null;
  };

  const handleFileUpload = async (event) => {
    if (!libsLoaded) return;
    const file = event.target.files[0];
    if (!file) return;
    setFileName(file.name);

    // 1. Read the file
    const arrayBuffer = await file.arrayBuffer();

    // 2. CRITICAL FIX: Clone the buffer! 
    // We keep 'arrayBuffer' safe in state for Saving.
    // We give 'bufferClone' to the viewer.
    setPdfBytes(arrayBuffer);
    const bufferClone = arrayBuffer.slice(0);

    try {
      // 3. Load PDF using the CLONE
      const loadedPdf = await window.pdfjsLib.getDocument(new Uint8Array(bufferClone)).promise;

      setPdfDoc(loadedPdf);
      setNumPages(loadedPdf.numPages);
      setPageOrder(Array.from({ length: loadedPdf.numPages }, (_, i) => i + 1));
      setPageNum(1);
      setAnnotations([]);
      setDeletedPages([]);
      setExtraPages(0);
      setPageBackgrounds({});
      setTextInput({ ...textInput, isVisible: false });
      setImageInput({ ...imageInput, isVisible: false });
    } catch (error) {
      console.error("Error loading PDF:", error);
      alert("Failed to load PDF.");
    }
  };

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const aspectRatio = img.height / img.width;
        setImageInput({
          x: 50, y: 50,
          width: 200, height: 200 * aspectRatio,
          src: img.src,
          image: img,
          isVisible: true,
          id: Date.now(),
          aspectRatio: aspectRatio,
          opacity: 1, rotation: 0
        });
        setTool('cursor');
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
    e.target.value = null;
  };

  // Helper to get X/Y from either Mouse or Touch
  const getClientPos = (e) => {
    if (e.touches && e.touches.length > 0) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    if (e.changedTouches && e.changedTouches.length > 0) return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
    return { x: e.clientX, y: e.clientY };
  };

  const startDrag = (e, type) => {
    e.stopPropagation(); // Stop click from going to canvas
    setActiveDrag(type);
    const boxRect = overlayCanvasRef.current.getBoundingClientRect();
    const pos = getClientPos(e);
    const target = type === 'text' ? textInput : imageInput;
    setDragOffset({ x: pos.x - boxRect.left - target.x, y: pos.y - boxRect.top - target.y });
  };

  const startResize = (e, type) => {
    e.stopPropagation();
    setActiveResize(type);
    const pos = getClientPos(e); // Use the helper
    const canvasRect = overlayCanvasRef.current.getBoundingClientRect();
    // Calculate resize start relative to canvas to avoid jumping
    const relativeX = pos.x - canvasRect.left;
    const relativeY = pos.y - canvasRect.top;
    const target = type === 'text' ? textInput : imageInput;
    setResizeStart({ w: target.width, h: target.height, x: relativeX, y: relativeY });
  };

  const saveImageInput = () => {
    setAnnotations(prev => [...prev, {
      type: 'image', x: imageInput.x, y: imageInput.y, width: imageInput.width, height: imageInput.height,
      src: imageInput.src,
      image: imageInput.image,
      rotation: imageInput.rotation, opacity: imageInput.opacity,
      page: pageOrder[pageNum - 1] || pageNum, id: imageInput.id || Date.now()
    }]);
    setImageInput({ ...imageInput, isVisible: false });
  };

  const saveTextInput = () => {
    if (textInput.text.trim() !== '') {
      setAnnotations(prev => [...prev, {
        type: 'text',
        x: textInput.x, y: textInput.y, width: textInput.width, height: textInput.height,
        text: textInput.text, color: color, fontSize: textInput.fontSize, fontFamily: textInput.fontFamily,
        isBold: textInput.isBold, isItalic: textInput.isItalic, isUnderline: textInput.isUnderline, // 👈 Save it
        page: pageOrder[pageNum - 1] || pageNum, id: textInput.id || Date.now(),
        opacity: textInput.opacity, rotation: textInput.rotation
      }]);
    }
    setTextInput({ ...textInput, isVisible: false, text: '' });
  };

  const cancelTextInput = () => { setTextInput({ ...textInput, isVisible: false, text: '' }); };

  useEffect(() => {
    if (pdfDoc) {
      renderPdfLayer();
    }
  }, [pdfDoc, pageNum, scale, deletedPages, isGrayscale, pageBackgrounds]);

  const renderPdfLayer = async () => {
    if (!pdfDoc || !pdfCanvasRef.current) return;

    // A. Handle Newly Added Blank Pages (Extra Pages)
    if (pageNum > pageOrder.length) {
      const canvas = pdfCanvasRef.current;
      const context = canvas.getContext('2d');

      // High DPI Support for Blank Pages
      const dpr = window.devicePixelRatio || 1;

      // A4 Size at standard 72 DPI is 595x842. We multiply by scale (2.0) and DPR.
      const displayWidth = 595 * scale;
      const displayHeight = 842 * scale;

      // Set Display Size (CSS)
      canvas.style.width = `${displayWidth}px`;
      canvas.style.height = `${displayHeight}px`;

      // Set Actual Memory Size (Pixels) - Sharper!
      canvas.width = displayWidth * dpr;
      canvas.height = displayHeight * dpr;

      // Normalize coordinate system
      context.scale(dpr, dpr);

      // Update State for Overlay Match
      if (canvasDimensions.width !== displayWidth || canvasDimensions.height !== displayHeight) {
        setCanvasDimensions({ width: displayWidth, height: displayHeight });
      }

      context.clearRect(0, 0, displayWidth, displayHeight);

      // DRAW BACKGROUND
      if (pageBackgrounds[pageNum]) {
        const bgData = pageBackgrounds[pageNum];
        const bgImg = new Image();
        bgImg.src = bgData.src || bgData;

        try {
          await new Promise(r => bgImg.onload = r);
          context.save();
          context.globalAlpha = bgData.opacity || 1;
          context.drawImage(bgImg, 0, 0, displayWidth, displayHeight);
          context.restore();
        } catch (e) { console.error(e); }
      } else {
        context.fillStyle = 'white';
        context.fillRect(0, 0, displayWidth, displayHeight);
      }
      return;
    }

    // B. Handle Normal PDF Pages
    const actualPageNumber = pageOrder[pageNum - 1];
    const canvas = pdfCanvasRef.current;
    const context = canvas.getContext('2d');

    if (deletedPages.includes(actualPageNumber)) return;

    try {
      const page = await pdfDoc.getPage(actualPageNumber);

      // HIGH DPI MAGIC:
      // We render at a higher resolution based on the device (e.g. Retina = 2x)
      const dpr = window.devicePixelRatio || 1;
      const viewport = page.getViewport({ scale: scale * dpr });

      // We calculate what the CSS size should be (View size)
      const displayWidth = viewport.width / dpr;
      const displayHeight = viewport.height / dpr;

      // 1. Set CSS size (Layout size)
      canvas.style.width = `${displayWidth}px`;
      canvas.style.height = `${displayHeight}px`;

      // 2. Set Bitmap size (Actual pixels)
      canvas.width = viewport.width;
      canvas.height = viewport.height;

      // 3. Update React State to sync the Overlay Layer
      if (canvasDimensions.width !== displayWidth || canvasDimensions.height !== displayHeight) {
        setCanvasDimensions({ width: displayWidth, height: displayHeight });
      }

      context.clearRect(0, 0, canvas.width, canvas.height);

      // Draw Background (Correctly Scaled)
      if (pageBackgrounds[actualPageNumber]) {
        const bgData = pageBackgrounds[actualPageNumber];
        const bgImg = new Image();
        bgImg.src = bgData.src || bgData;
        try {
          await new Promise(r => bgImg.onload = r);
          context.save();
          // We must scale the context because drawImage uses raw pixels
          context.scale(dpr, dpr);
          context.globalAlpha = bgData.opacity || 1;
          context.drawImage(bgImg, 0, 0, displayWidth, displayHeight);
          context.restore();
          // Reset scale for PDF render which handles its own scaling
        } catch (e) { }
      } else {
        context.fillStyle = 'white';
        context.fillRect(0, 0, canvas.width, canvas.height);
      }

      // Render PDF (PDF.js handles the scaling internally based on the viewport we created)
      const renderContext = {
        canvasContext: context,
        viewport: viewport
      };

      context.filter = isGrayscale ? 'grayscale(100%)' : 'none';
      await page.render(renderContext).promise;
      context.filter = 'none';

    } catch (error) { console.error(error); }
  };

  useEffect(() => {
    if (canvasDimensions.width > 0) {
      renderOverlayLayer();
    }
  }, [annotations, isDrawing, canvasDimensions, tool, pageNum, currentPath]);

  const renderOverlayLayer = () => {
    const canvas = overlayCanvasRef.current;
    const context = canvas.getContext('2d');

    if (canvas.width !== canvasDimensions.width || canvas.height !== canvasDimensions.height) {
      canvas.width = canvasDimensions.width;
      canvas.height = canvasDimensions.height;
    }
    context.clearRect(0, 0, canvas.width, canvas.height);

    const actualPageNumber = pageOrder[pageNum - 1];
    // For new pages not in pageOrder, we still use pageNum. For ordered pages, use actualPageNumber.
    const pageId = actualPageNumber || pageNum;

    const currentAnnotations = annotations.filter(ann => ann.page === pageId);

    currentAnnotations.forEach(ann => {
      context.save();
      context.globalAlpha = ann.opacity !== undefined ? ann.opacity : 1;

      if (ann.type === 'text' || ann.type === 'image') {
        const cx = ann.x + ann.width / 2;
        const cy = ann.y + ann.height / 2;
        context.translate(cx, cy);
        context.rotate((ann.rotation || 0) * Math.PI / 180);
        context.translate(-cx, -cy);
      }

      if (ann.type === 'whiteout') {
        context.fillStyle = 'white';
        context.fillRect(ann.x, ann.y, ann.width, ann.height);
      } else if (ann.type === 'text') {
        const fontStyle = ann.isItalic ? 'italic' : '';
        const fontWeight = ann.isBold ? 'bold' : '';
        context.font = `${fontStyle} ${fontWeight} ${ann.fontSize}px "${ann.fontFamily}"`;
        context.fillStyle = ann.color;
        context.textBaseline = 'top';
        context.fillText(ann.text, ann.x + 4, ann.y + 4);

        // 👇 NEW: Manually draw underline if selected
        if (ann.isUnderline) {
          const textWidth = context.measureText(ann.text).width;
          context.beginPath();
          // Draw line 2px below text baseline
          context.moveTo(ann.x + 4, ann.y + ann.fontSize + 6);
          context.lineTo(ann.x + 4 + textWidth, ann.y + ann.fontSize + 6);
          context.strokeStyle = ann.color;
          context.lineWidth = Math.max(1, ann.fontSize / 15); // Scale thickness with font
          context.stroke();
        }
      } else if (ann.type === 'image') {
        // Safety Check: Only draw if image object exists
        if (ann.image) {
          context.drawImage(ann.image, ann.x, ann.y, ann.width, ann.height);
        } else if (ann.src) {
          // Fallback: If object is missing but src exists, try to reload it (prevents white screen)
          const img = new Image();
          img.src = ann.src;
          context.drawImage(img, ann.x, ann.y, ann.width, ann.height);
        }
      } else if (ann.type === 'drawing' && ann.points?.length > 0) {
        context.strokeStyle = ann.color;
        context.lineWidth = ann.lineWidth;
        context.lineCap = 'round';
        context.lineJoin = 'round';
        context.beginPath();
        context.moveTo(ann.points[0].x, ann.points[0].y);
        ann.points.forEach(p => context.lineTo(p.x, p.y));
        context.stroke();
      }
      context.restore();
    });

    if (isDrawing && tool === 'pen' && currentPath.length > 0) {
      context.strokeStyle = color;
      context.lineWidth = brushSize;
      context.lineCap = 'round';
      context.lineJoin = 'round';
      context.beginPath();
      context.moveTo(currentPath[0].x, currentPath[0].y);
      currentPath.forEach(p => context.lineTo(p.x, p.y));
      context.stroke();
    }
  };

  const getMousePos = (e) => {
    if (!overlayCanvasRef.current) return { x: 0, y: 0 };
    const rect = overlayCanvasRef.current.getBoundingClientRect();

    let clientX, clientY;

    // 1. Get raw coordinates (Touch or Mouse)
    if (e.touches && e.touches.length > 0) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else if (e.changedTouches && e.changedTouches.length > 0) {
      clientX = e.changedTouches[0].clientX;
      clientY = e.changedTouches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    // 2. Calculate position relative to canvas
    // 👇 IMPORTANT: We divide by 'zoom' to correct the coordinates!
    return {
      x: (clientX - rect.left) / zoom,
      y: (clientY - rect.top) / zoom
    };
  };

  const handleMouseDown = (e) => {
    if (activeDrag || activeResize || !pdfDoc) return;
    if (textInput.isVisible || imageInput.isVisible) return;

    const { x, y } = getMousePos(e);

    if (tool === 'cursor') {
      const clickedItem = [...annotations].reverse().find(ann =>
        ann.page === pageNum &&
        x >= ann.x && x <= ann.x + ann.width &&
        y >= ann.y && y <= ann.y + ann.height
      );

      if (clickedItem) {
        setAnnotations(prev => prev.filter(a => a.id !== clickedItem.id));

        if (clickedItem.type === 'text') {
          setTextInput({
            ...clickedItem,
            isVisible: true,
            opacity: clickedItem.opacity || 1,
            rotation: clickedItem.rotation || 0
          });
          setColor(clickedItem.color);
        } else if (clickedItem.type === 'image') {
          setImageInput({
            ...clickedItem,
            isVisible: true,
            aspectRatio: clickedItem.width ? (clickedItem.height / clickedItem.width) : 1,
            opacity: clickedItem.opacity !== undefined ? clickedItem.opacity : 1,
            rotation: clickedItem.rotation || 0
          });
        }
        return;
      }

      const pos = getClientPos(e);
      setIsPanning(true);
      setPanStart({
        x: pos.x,
        y: pos.y,
        scrollTop: containerRef.current ? containerRef.current.scrollTop : 0,
        scrollLeft: containerRef.current ? containerRef.current.scrollLeft : 0
      });
    }

    if (tool === 'picker') {
      const pdfCtx = pdfCanvasRef.current.getContext('2d');
      const pixel = pdfCtx.getImageData(x, y, 1, 1).data;
      const hex = "#" + ((1 << 24) + (pixel[0] << 16) + (pixel[1] << 8) + pixel[2]).toString(16).slice(1);
      setColor(hex);
      setTool('cursor');
    } else if (tool === 'text') {
      setTextInput({ ...textInput, x, y, width: 200, height: 40, text: '', isVisible: true, id: Date.now(), opacity: 1, rotation: 0 });
    } else if (tool === 'whiteout' || tool === 'pen') {
      setIsDrawing(true);
      setStartPos({ x, y });
      if (tool === 'pen') {
        setCurrentPath([{ x, y }]);
      }
    }
  };

  const handleMouseMove = (e) => {
    if (!isDrawing && !activeDrag && !activeResize && !isPanning) return;

    if (isPanning && containerRef.current) {
      e.preventDefault();
      const pos = getClientPos(e);
      const dx = pos.x - panStart.x;
      const dy = pos.y - panStart.y;
      containerRef.current.scrollTop = panStart.scrollTop - dy;
      containerRef.current.scrollLeft = panStart.scrollLeft - dx;
      return;
    }

    const { x, y } = getMousePos(e);

    if (activeResize) {
      const dx = x - resizeStart.x;
      const dy = y - resizeStart.y;

      if (activeResize === 'text') {
        const newWidth = Math.max(50, resizeStart.w + dx);
        const newHeight = Math.max(20, resizeStart.h + dy);
        const newFontSize = Math.round(newHeight * 0.6);
        setTextInput(prev => ({ ...prev, width: newWidth, height: newHeight, fontSize: newFontSize }));
      } else if (activeResize === 'image') {
        const newWidth = Math.max(50, resizeStart.w + dx);
        const newHeight = newWidth * imageInput.aspectRatio;
        setImageInput(prev => ({ ...prev, width: newWidth, height: newHeight }));
      }
      return;
    }

    if (activeDrag) {
      const rect = overlayCanvasRef.current.getBoundingClientRect();
      const newX = e.clientX - rect.left - dragOffset.x;
      const newY = e.clientY - rect.top - dragOffset.y;

      if (activeDrag === 'text') {
        setTextInput(prev => ({ ...prev, x: newX, y: newY }));
      } else if (activeDrag === 'image') {
        setImageInput(prev => ({ ...prev, x: newX, y: newY }));
      }
      return;
    }

    if (isDrawing && tool === 'pen') {
      setCurrentPath(prev => [...prev, { x, y }]);
    } else if (isDrawing && tool === 'whiteout') {
      const ctx = overlayCanvasRef.current.getContext('2d');
      renderOverlayLayer();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.fillRect(startPos.x, startPos.y, x - startPos.x, y - startPos.y);
    }
  };

  const handleMouseUp = (e) => {
    if (isPanning) setIsPanning(false);
    if (activeDrag) setActiveDrag(null);
    if (activeResize) setActiveResize(null);

    if (isDrawing) {
      const { x, y } = getMousePos(e);
      setIsDrawing(false);

      if (tool === 'whiteout') {
        const ann = { type: 'whiteout', x: Math.min(startPos.x, x), y: Math.min(startPos.y, y), width: Math.abs(x - startPos.x), height: Math.abs(y - startPos.y), page: pageOrder[pageNum - 1] || pageNum, id: Date.now() };
        setAnnotations(prev => [...prev, ann]);
      } else if (tool === 'pen') {
        setAnnotations(prev => [...prev, { type: 'drawing', points: currentPath, color: color, lineWidth: brushSize, page: pageOrder[pageNum - 1] || pageNum, id: Date.now() }]);
        setCurrentPath([]);
      }
    }
  };

  // --- Mobile Touch Handlers ---
  const handleTouchStart = (e) => {
    if (e.cancelable) e.preventDefault(); // STOP SCREEN SCROLL
    handleMouseDown(e); // Pretend it's a mouse click
  }

  const handleTouchMove = (e) => {
    if (e.cancelable) e.preventDefault(); // STOP SCREEN SCROLL
    handleMouseMove(e); // Pretend it's a mouse moving
  }

  const handleTouchEnd = (e) => {
    if (e.cancelable) e.preventDefault();
    handleMouseUp(e); // Pretend mouse button released
  }

  const handleDownload = async () => {
    if (!pdfDoc) return;
    setIsSaving(true);

    try {
      // OPTION A: ORIGINAL QUALITY (Best for printing/official use)
      // We use this if the slider is at 100%
      if (saveQuality === 100) {
        if (!window.PDFLib || !pdfBytes) {
          alert("Original file data missing. Please reload.");
          setIsSaving(false); return;
        }

        const { PDFDocument, rgb, StandardFonts } = window.PDFLib;
        const pdfDocOriginal = await PDFDocument.load(pdfBytes); // Load the SAFE copy
        const newPdfDoc = await PDFDocument.create();

        for (let i = 0; i < pageOrder.length; i++) {
          const actualPageNumber = pageOrder[i];
          if (deletedPages.includes(actualPageNumber)) continue;

          let page;
          if (actualPageNumber <= pdfDocOriginal.getPageCount()) {
            const [copiedPage] = await newPdfDoc.copyPages(pdfDocOriginal, [actualPageNumber - 1]);
            page = newPdfDoc.addPage(copiedPage);
          } else {
            page = newPdfDoc.addPage([595, 842]);
          }
          const { width, height } = page.getSize();

          // Draw Backgrounds
          if (pageBackgrounds[actualPageNumber]) {
            const bgData = pageBackgrounds[actualPageNumber];
            const bgSrc = bgData.src || bgData;
            const bgOpacity = bgData.opacity || 1;
            let bgImage;
            if (bgSrc.startsWith('data:image/png')) bgImage = await newPdfDoc.embedPng(bgSrc);
            else if (bgSrc.startsWith('data:image/jpeg') || bgSrc.startsWith('data:image/jpg')) bgImage = await newPdfDoc.embedJpg(bgSrc);
            if (bgImage) page.drawImage(bgImage, { x: 0, y: 0, width, height, opacity: bgOpacity });
          }

          // Draw Annotations (The Math Logic)
          const pageAnns = annotations.filter(a => a.page === actualPageNumber);
          for (const ann of pageAnns) {
            const scaleFactor = 1 / scale;

            const x = ann.x * scaleFactor;
            const rawY = ann.y * scaleFactor;
            const objHeight = ann.height * scaleFactor;

            if (ann.type === 'text') {
              const fontSize = ann.fontSize * scaleFactor;
              let font = await newPdfDoc.embedFont(StandardFonts.Helvetica);
              if (ann.isBold && ann.isItalic) font = await newPdfDoc.embedFont(StandardFonts.HelveticaBoldOblique);
              else if (ann.isBold) font = await newPdfDoc.embedFont(StandardFonts.HelveticaBold);
              else if (ann.isItalic) font = await newPdfDoc.embedFont(StandardFonts.HelveticaOblique);

              const r = parseInt(ann.color.slice(1, 3), 16) / 255;
              const g = parseInt(ann.color.slice(3, 5), 16) / 255;
              const b = parseInt(ann.color.slice(5, 7), 16) / 255;

              page.drawText(ann.text, {
                x: x + 4,
                y: height - rawY - (fontSize * 0.8),
                size: fontSize,
                font: font,
                color: rgb(r, g, b),
                opacity: ann.opacity || 1,
                rotate: window.PDFLib.degrees(-(ann.rotation || 0)),
              });

              if (ann.isUnderline) {
                const textWidth = font.widthOfTextAtSize(ann.text, fontSize);
                const lineY = height - rawY - fontSize;
                page.drawLine({
                  start: { x: x + 4, y: lineY },
                  end: { x: x + 4 + textWidth, y: lineY },
                  thickness: Math.max(1, fontSize / 15),
                  color: rgb(r, g, b),
                  opacity: ann.opacity || 1
                });
              }
            }

            if (ann.type === 'whiteout') {
              page.drawRectangle({
                x: x,
                y: height - rawY - objHeight,
                width: ann.width * scaleFactor,
                height: objHeight,
                color: rgb(1, 1, 1),
              });
            }

            if (ann.type === 'image' && ann.src) {
              try {
                let pdfImage;
                // 1. Check if it's PNG
                if (ann.src.startsWith('data:image/png')) {
                  pdfImage = await newPdfDoc.embedPng(ann.src);
                }
                // 2. Check if it's JPEG
                else if (ann.src.startsWith('data:image/jpeg') || ann.src.startsWith('data:image/jpg')) {
                  pdfImage = await newPdfDoc.embedJpg(ann.src);
                }
                // 3. Fallback: Convert GIF/WebP/etc to PNG using a temporary Canvas
                else {
                  const pngDataUrl = await new Promise((resolve) => {
                    const tempImg = new Image();
                    tempImg.onload = () => {
                      const canvas = document.createElement('canvas');
                      canvas.width = tempImg.width;
                      canvas.height = tempImg.height;
                      const ctx = canvas.getContext('2d');
                      ctx.drawImage(tempImg, 0, 0);
                      resolve(canvas.toDataURL('image/png'));
                    };
                    tempImg.src = ann.src;
                  });
                  pdfImage = await newPdfDoc.embedPng(pngDataUrl);
                }

                page.drawImage(pdfImage, {
                  x, y: height - rawY - objHeight, width: ann.width * scaleFactor, height: objHeight,
                  opacity: ann.opacity || 1, rotate: window.PDFLib.degrees(-(ann.rotation || 0))
                });
              } catch (e) { console.error("Image save error", e); }
            }

            if (ann.type === 'drawing' && ann.points.length > 0) {
              const pathColor = ann.color || '#000000';
              const r = parseInt(pathColor.slice(1, 3), 16) / 255;
              const g = parseInt(pathColor.slice(3, 5), 16) / 255;
              const b = parseInt(pathColor.slice(5, 7), 16) / 255;

              for (let j = 0; j < ann.points.length - 1; j++) {
                const p1 = ann.points[j];
                const p2 = ann.points[j + 1];

                page.drawLine({
                  start: { x: p1.x * scaleFactor, y: height - (p1.y * scaleFactor) },
                  end: { x: p2.x * scaleFactor, y: height - (p2.y * scaleFactor) },
                  thickness: (ann.lineWidth || 3) * scaleFactor,
                  color: rgb(r, g, b),
                  lineCap: 'round'
                });
              }
            }
          }
        }

        const savedBytes = await newPdfDoc.save();
        const blob = new Blob([savedBytes], { type: 'application/pdf' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `Original_${fileName}`;
        link.click();
      }
      // OPTION B: COMPRESSED (Smaller Size)
      // We use this if slider is < 100%
      else {
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF({ unit: 'px', hotfixes: ['px_scaling'] });
        let isFirst = true;

        // CALCULATE QUALITY
        // Quality 0.1 (Smallest) to 1.0 (Best)
        const jpgQuality = saveQuality / 100;
        // Scale: 1.0 (Low Res) to 2.0 (High Res)
        const saveScale = saveQuality < 50 ? 1.0 : 2.0;

        for (let i = 0; i < pageOrder.length; i++) {
          const actualPageNumber = pageOrder[i];
          if (deletedPages.includes(actualPageNumber)) continue;
          if (!isFirst) pdf.addPage();

          const page = await pdfDoc.getPage(actualPageNumber);
          const viewport = page.getViewport({ scale: saveScale });

          const tempCanvas = document.createElement('canvas');
          const ctx = tempCanvas.getContext('2d');
          tempCanvas.width = viewport.width;
          tempCanvas.height = viewport.height;

          if (isFirst) { pdf.internal.pageSize.setWidth(tempCanvas.width); pdf.internal.pageSize.setHeight(tempCanvas.height); }

          // Base render of the page
          await page.render({ canvasContext: ctx, viewport }).promise;

          // Draw Backgrounds on top of PDF page
          if (pageBackgrounds[actualPageNumber]) {
            const bgData = pageBackgrounds[actualPageNumber];
            const bgImg = new Image();
            bgImg.src = bgData.src || bgData;
            try {
              await new Promise(r => bgImg.onload = r);
              ctx.save();
              ctx.globalAlpha = bgData.opacity || 1;
              ctx.drawImage(bgImg, 0, 0, tempCanvas.width, tempCanvas.height);
              ctx.restore();
            } catch (e) { }
          }

          // Draw Annotations
          const pageAnns = annotations.filter(a => a.page === actualPageNumber);
          const renderScale = saveScale / scale; // Adjust annotation scale
          pageAnns.forEach(ann => {
            ctx.save();
            ctx.globalAlpha = ann.opacity !== undefined ? ann.opacity : 1;

            // You'll need to re-implement the drawing logic for annotations on the canvas here.
            // This is a simplified example for text.
            if (ann.type === 'text') {
              ctx.font = `${ann.isItalic ? 'italic' : ''} ${ann.isBold ? 'bold' : ''} ${ann.fontSize * renderScale}px "${ann.fontFamily}"`;
              ctx.fillStyle = ann.color;
              ctx.textBaseline = 'top';
              ctx.fillText(ann.text, ann.x * renderScale, ann.y * renderScale);
            }
            // Add logic for images, drawings etc. similar to the old handleDownload

            ctx.restore();
          });

          const imgData = tempCanvas.toDataURL('image/jpeg', jpgQuality);
          pdf.addImage(imgData, 'JPEG', 0, 0, tempCanvas.width, tempCanvas.height);
          isFirst = false;
        }
        pdf.save(`Compressed_${fileName}`);
      }

    } catch (err) {
      console.error("Save error:", err);
      alert("Error saving. See console.");
    } finally {
      setIsSaving(false);
    }
  };

  const undoLast = () => {
    setAnnotations(prev => {
      const lastIndex = prev.map(a => a.page === pageNum).lastIndexOf(true);
      if (lastIndex > -1) {
        return [...prev.slice(0, lastIndex), ...prev.slice(lastIndex + 1)];
      }
      return prev;
    });
  };

  return (
    // ROOT: Changed to column on mobile, row on desktop. Fixed height to stop body scroll.
    <div className="flex flex-col md:flex-row h-screen bg-gray-100 font-sans overflow-hidden">

      {/* SIDEBAR / TOOLBOX */}
      {/* Mobile: Fixed at bottom, height 35%, full width */}
      {/* Desktop: Fixed at left, full height, width 64 */}
      <div className="w-full md:w-64 h-[35vh] md:h-full bg-white md:border-r border-t md:border-t-0 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)] md:shadow-md flex flex-col z-50 order-2 md:order-1">

        {/* Header of Sidebar */}
        <div className="p-3 md:p-4 border-b flex items-center gap-2 text-blue-700 font-bold text-lg md:text-xl bg-gray-50 md:bg-white">
          <FileText size={20} /> <span className="hidden md:inline">PDF Editor</span> <span className="md:hidden">Tools & Settings</span>
        </div>

        {/* Scrollable Tool Content */}
        <div className="p-3 md:p-4 flex-1 overflow-y-auto">
          {pdfDoc ? (
            <div className="flex flex-col gap-4 md:gap-6">

              {/* Tools Section */}
              <div>
                <label className="text-xs font-bold text-gray-500 uppercase mb-2 block sticky top-0 bg-white z-10">Tools</label>
                <div className="grid grid-cols-4 md:grid-cols-2 gap-2">
                  <ToolButton active={tool === 'cursor'} onClick={() => setTool('cursor')} icon={<MousePointer2 size={18} />} title="Select" label="Select" />
                  <ToolButton active={tool === 'whiteout'} onClick={() => setTool('whiteout')} icon={<Eraser size={18} />} title="Whiteout" label="Erase" />
                  <ToolButton active={tool === 'text'} onClick={() => setTool('text')} icon={<Type size={18} />} title="Add Text" label="Text" />
                  <ToolButton active={tool === 'pen'} onClick={() => setTool('pen')} icon={<Pen size={18} />} title="Draw" label="Pen" />
                  <ToolButton active={tool === 'image'} onClick={() => imageInputRef.current.click()} icon={<ImageIcon size={18} />} title="Add Image" label="Img" />
                  <ToolButton active={tool === 'picker'} onClick={() => setTool('picker')} icon={<Pipette size={18} />} title="Pick Color" label="Color" />
                </div>
              </div>

              {/* Page Actions */}
              <div className="border-t pt-4">
                <label className="text-xs font-bold text-gray-500 uppercase mb-2 block">Pages</label>
                <div className="flex gap-2 mb-2 overflow-x-auto">
                  {/* Horizontal scroll for buttons on mobile to save space */}
                  <button onClick={() => setIsReordering(true)} className="whitespace-nowrap flex items-center gap-2 px-3 py-2 rounded text-xs font-medium bg-purple-50 text-purple-700 border border-purple-200">
                    <Move size={14} /> Reorder
                  </button>
                  <button onClick={() => setIsGrayscale(!isGrayscale)} className={`whitespace-nowrap flex items-center gap-2 px-3 py-2 rounded text-xs font-medium border ${isGrayscale ? 'bg-gray-800 text-white' : 'bg-white text-gray-700'}`}>
                    <div className={`w-3 h-3 rounded-full border ${isGrayscale ? 'bg-gray-400' : 'bg-gradient-to-r from-blue-400 to-red-400'}`}></div> B&W
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => { setExtraPages(p => p + 1); setPageNum(numPages + extraPages + 1); }} className="flex items-center justify-center p-2 rounded bg-blue-50 text-blue-600 border border-blue-200 text-xs font-bold"><FilePlus size={14} className="mr-1" /> Add Page</button>
                  <button onClick={() => { if (pageNum > numPages || confirm(`Delete Page ${pageNum}?`)) { setDeletedPages(prev => [...prev, pageNum]); } }} className="flex items-center justify-center p-2 rounded bg-red-50 text-red-600 border border-red-200 text-xs font-bold"><Trash2 size={14} className="mr-1" /> Del Page</button>
                </div>
              </div>

              {/* PAGE BACKGROUND SECTION */}
              <div className="border-t pt-4">
                <label className="text-xs font-bold text-gray-500 uppercase mb-2 block">Page Background</label>

                {/* 1. Upload Button */}
                <button
                  onClick={() => bgInputRef.current.click()}
                  className="w-full flex items-center justify-center gap-2 p-2 rounded mb-2 text-sm font-medium bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100"
                >
                  <ImageIcon size={16} />
                  {pageBackgrounds[pageOrder[pageNum - 1] || pageNum] ? 'Change Background' : 'Set Background'}
                </button>
                <input ref={bgInputRef} type="file" accept="image/*" className="hidden" onChange={handleBgUpload} />

                {/* 2. Opacity Slider (Only show if background exists) */}
                {pageBackgrounds[pageOrder[pageNum - 1] || pageNum] && (
                  <div className="bg-gray-50 p-2 rounded border animate-fade-in">
                    <div className="flex justify-between mb-1">
                      <span className="text-[10px] font-bold text-gray-600">Intensity</span>
                      <button
                        onClick={() => {
                          // Remove background logic
                          const actualPage = pageOrder[pageNum - 1] || pageNum;
                          const newBgs = { ...pageBackgrounds };
                          delete newBgs[actualPage];
                          setPageBackgrounds(newBgs);
                        }}
                        className="text-[10px] text-red-500 hover:underline"
                      >
                        Remove
                      </button>
                    </div>
                    <input
                      type="range" min="0.1" max="1" step="0.1"
                      value={pageBackgrounds[pageOrder[pageNum - 1] || pageNum].opacity || 1}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        const actualPage = pageOrder[pageNum - 1] || pageNum;
                        setPageBackgrounds(prev => ({
                          ...prev,
                          [actualPage]: { ...prev[actualPage], opacity: val }
                        }));
                      }}
                      className="w-full h-2 bg-gray-300 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>
                )}
              </div>

              <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />

              {/* Properties (Color, Size, Opacity, Rotation) */}
              <div className="flex flex-col gap-3 bg-gray-50 p-2 rounded border">

                {/* Color Picker - Always show if not using image */}
                {tool !== 'image' && (
                  <div className="flex items-center gap-2">
                    <label className="text-[10px] font-bold text-gray-500 uppercase w-12">Color</label>
                    <div className="flex items-center gap-2 flex-1">
                      <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="w-8 h-8 rounded border-none cursor-pointer" />
                      <button onClick={undoLast} className="ml-auto p-2 bg-white border rounded text-gray-700 hover:bg-gray-100"><Undo size={16} /></button>
                    </div>
                  </div>
                )}

                {/* Context Aware Controls (Only show when editing Item) */}
                {(textInput.isVisible || imageInput.isVisible) && (
                  <>
                    <div className="h-px bg-gray-200 my-3"></div>
                    <label className="text-[10px] font-bold text-blue-600 uppercase mb-2 block">
                      {textInput.isVisible ? 'Text Formatting' : 'Image Settings'}
                    </label>

                    {/* TEXT SPECIFIC CONTROLS */}
                    {textInput.isVisible && (
                      <div className="flex flex-col gap-3 mb-3">

                        {/* Font Family & Size Row */}
                        <div className="flex gap-2">
                          <select
                            value={textInput.fontFamily}
                            onChange={(e) => setTextInput({ ...textInput, fontFamily: e.target.value })}
                            className="flex-1 text-xs border rounded p-1.5 bg-white h-8"
                          >
                            <option value="Arial">Arial</option>
                            <option value="Times New Roman">Times New Roman</option>
                            <option value="Courier New">Courier</option>
                            <option value="Georgia">Georgia</option>
                            <option value="Verdana">Verdana</option>
                          </select>
                          <input
                            type="number"
                            min="6" max="100"
                            value={textInput.fontSize}
                            onChange={(e) => setTextInput({ ...textInput, fontSize: Number(e.target.value) })}
                            className="w-14 text-xs border rounded p-1.5 h-8 text-center"
                          />
                        </div>

                        {/* Bold / Italic / Underline Toggles */}
                        <div className="flex gap-1 bg-gray-100 p-1 rounded border justify-between">
                          <button
                            onClick={() => setTextInput(prev => ({ ...prev, isBold: !prev.isBold }))}
                            className={`p-1.5 rounded flex-1 flex justify-center ${textInput.isBold ? 'bg-blue-200 text-blue-800' : 'hover:bg-gray-200'}`}
                          >
                            <Bold size={16} />
                          </button>
                          <button
                            onClick={() => setTextInput(prev => ({ ...prev, isItalic: !prev.isItalic }))}
                            className={`p-1.5 rounded flex-1 flex justify-center ${textInput.isItalic ? 'bg-blue-200 text-blue-800' : 'hover:bg-gray-200'}`}
                          >
                            <Italic size={16} />
                          </button>
                          <button
                            onClick={() => setTextInput(prev => ({ ...prev, isUnderline: !prev.isUnderline }))}
                            className={`p-1.5 rounded flex-1 flex justify-center ${textInput.isUnderline ? 'bg-blue-200 text-blue-800' : 'hover:bg-gray-200'}`}
                          >
                            <Underline size={16} />
                          </button>
                        </div>
                      </div>
                    )}

                    {/* ... (Keep your existing Opacity and Rotate sliders here) ... */}
                    {/* Opacity Slider */}
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-500 w-12">Opacity</span>
                      <input
                        type="range" min="0.1" max="1" step="0.1"
                        value={textInput.isVisible ? textInput.opacity : imageInput.opacity}
                        onChange={(e) => {
                          const val = Number(e.target.value);
                          if (textInput.isVisible) setTextInput({ ...textInput, opacity: val });
                          else setImageInput({ ...imageInput, opacity: val });
                        }}
                        className="flex-1 h-1.5 bg-gray-300 rounded-lg appearance-none cursor-pointer"
                      />
                    </div>

                    {/* Rotation Slider */}
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-500 w-12">Rotate</span>
                      <input
                        type="range" min="0" max="360"
                        value={textInput.isVisible ? textInput.rotation : imageInput.rotation}
                        onChange={(e) => {
                          const val = Number(e.target.value);
                          if (textInput.isVisible) setTextInput({ ...textInput, rotation: val });
                          else setImageInput({ ...imageInput, rotation: val });
                        }}
                        className="flex-1 h-1.5 bg-gray-300 rounded-lg appearance-none cursor-pointer"
                      />
                    </div>
                  </>
                )}

                {/* Pen Brush Size */}
                {tool === 'pen' && (
                  <div>
                    <span className="text-[10px] font-bold text-gray-600 block mb-1">Brush Size: {brushSize}px</span>
                    <input type="range" min="1" max="20" value={brushSize} onChange={(e) => setBrushSize(Number(e.target.value))} className="w-full h-2 bg-gray-300 rounded-lg appearance-none" />
                  </div>
                )}
              </div>

              <div className="mt-4 pb-4">
                {/* PLACE THIS ABOVE THE SAVE BUTTON */}
                <div className="bg-blue-50 p-3 rounded-lg border border-blue-200 mb-2">
                  <div className="flex justify-between items-center mb-2">
                    <label className="text-xs font-bold text-blue-800 uppercase">Save Mode</label>
                    <span className="text-xs font-bold bg-white px-2 py-0.5 rounded shadow text-blue-600">
                      {saveQuality === 100 ? "Original" : `${saveQuality}%`}
                    </span>
                  </div>

                  <input
                    type="range"
                    min="10"
                    max="100"
                    step="10"
                    value={saveQuality}
                    onChange={(e) => setSaveQuality(Number(e.target.value))}
                    className="w-full h-2 bg-blue-200 rounded-lg appearance-none cursor-pointer"
                  />

                  <p className="text-[10px] text-gray-500 mt-1 text-center">
                    {saveQuality === 100
                      ? "Editable Text • Best Quality"
                      : "Flattened Image • Smaller Size"}
                  </p>
                </div>
                <button onClick={handleDownload} disabled={isSaving} className="flex items-center justify-center gap-2 w-full p-3 bg-green-600 active:bg-green-700 text-white rounded shadow-md text-sm font-bold">
                  {isSaving ? 'Saving...' : <><Save size={18} /> Save PDF</>}
                </button>
              </div>
            </div>
          ) : (<div className="text-center text-gray-400 mt-4 text-sm">Load PDF to edit</div>)}
        </div>
      </div>

      {/* MAIN CONTENT AREA */}
      {/* Mobile: Top 65% of screen. Desktop: Full height, right side */}
      <main className="flex-1 flex flex-col h-[65vh] md:h-screen order-1 md:order-2 bg-gray-200 relative">

        {/* HEADER */}
        <header className="flex items-center justify-between p-2 bg-white border-b shadow-sm z-30">
          <div className="flex items-center gap-2">
            <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept="application/pdf" className="hidden" />
            <button onClick={() => fileInputRef.current.click()} disabled={!libsLoaded} className="bg-blue-600 text-white p-2 rounded-md shadow-sm">
              <Upload size={18} />
            </button>

            {/* Compact Page Control for Mobile */}
            {pdfDoc && (
              <div className="flex items-center bg-gray-100 rounded border">
                <button disabled={pageNum <= 1} onClick={() => setPageNum(p => p - 1)} className="p-1 hover:bg-gray-200 disabled:opacity-30"><ChevronLeft size={16} /></button>
                <span className="px-2 text-xs font-bold text-gray-700">{pageNum}/{numPages + extraPages}</span>
                <button disabled={pageNum >= numPages + extraPages} onClick={() => setPageNum(p => p + 1)} className="p-1 hover:bg-gray-200 disabled:opacity-30"><ChevronRight size={16} /></button>
              </div>
            )}
          </div>

          {/* Login / Profile */}
          <div>
            {!user ? (
              <button onClick={handleLogin} className="bg-black text-white px-3 py-1.5 rounded text-xs font-bold flex items-center gap-1">
                <LogIn size={14} /> <span className="hidden sm:inline">Sign In</span>
              </button>
            ) : (
              <button onClick={() => setShowProfile(!showProfile)} className="bg-green-100 text-green-800 border border-green-200 px-3 py-1.5 rounded text-xs font-bold flex items-center gap-1">
                <User size={14} /> {user.displayName?.split(' ')[0]}
              </button>
            )}
          </div>
        </header>

        {/* CANVAS CONTAINER */}
        <div ref={containerRef} className="flex-1 overflow-auto p-2 md:p-8 flex justify-center relative touch-pan-x touch-pan-y bg-gray-200">

          {/* ZOOM CONTROLS - Floating, only affects document */}
          {pdfDoc && (
            <div className="fixed bottom-20 left-4 md:bottom-8 md:left-64 z-50 flex flex-col gap-2 bg-white p-1.5 rounded-lg shadow-xl border border-gray-300">
              <button onClick={() => setZoom(z => Math.min(3, z + 0.1))} className="p-2 bg-gray-50 hover:bg-gray-100 rounded text-blue-600"><ZoomIn size={20} /></button>
              <span className="text-center text-[10px] font-bold text-gray-500">{Math.round(zoom * 100)}%</span>
              <button onClick={() => setZoom(z => Math.max(0.5, z - 0.1))} className="p-2 bg-gray-50 hover:bg-gray-100 rounded text-blue-600"><ZoomOut size={20} /></button>
            </div>
          )}

          {pdfDoc ? (
            // This wrapper handles the SCROLL area
            <div className="relative" style={{
              width: canvasDimensions.width * zoom,
              height: canvasDimensions.height * zoom
            }}>

              {/* This div handles the MOUSE events and SCALING */}
              <div
                className="absolute top-0 left-0 origin-top-left bg-white shadow-lg"
                style={{
                  width: canvasDimensions.width,
                  height: canvasDimensions.height,
                  transform: `scale(${zoom})`  // 👈 THIS IS THE MAGIC ZOOM
                }}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
              >
                <canvas ref={pdfCanvasRef} className="absolute top-0 left-0" />

                {/* Overlay Canvas */}
                <canvas
                  ref={overlayCanvasRef}
                  onMouseDown={handleMouseDown}
                  onTouchStart={handleTouchStart}
                  // If tool is Pen, stop scrolling. If Select tool, allow scrolling.
                  style={{ touchAction: (tool === 'pen' || tool === 'whiteout') ? 'none' : 'pan-x pan-y' }}
                  className={`absolute top-0 left-0 z-10 ${tool === 'cursor' ? (isPanning ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-crosshair'}`}
                />

                {/* Text Input Render Logic */}
                {textInput.isVisible && (
                  <div
                    className="absolute z-20 border-2 border-blue-500 border-dashed"
                    style={{
                      left: textInput.x, top: textInput.y,
                      width: textInput.width, height: textInput.height,
                      transform: `rotate(${textInput.rotation}deg)`,
                      opacity: textInput.opacity
                    }}
                    onMouseDown={(e) => startDrag(e, 'text')}
                    onTouchStart={(e) => startDrag(e, 'text')}
                  >
                    <textarea ref={inputRef} value={textInput.text} onChange={(e) => setTextInput({ ...textInput, text: e.target.value })} className="w-full h-full bg-transparent p-1 resize-none text-lg leading-tight outline-none"
                      style={{
                        color: color,
                        fontSize: `${textInput.fontSize}px`,
                        fontFamily: textInput.fontFamily,
                        fontWeight: textInput.isBold ? 'bold' : 'normal',
                        fontStyle: textInput.isItalic ? 'italic' : 'normal',
                        textDecoration: textInput.isUnderline ? 'underline' : 'none' // 👈 Add this
                      }}
                    />
                    <div className="absolute -top-10 right-0 flex gap-2"><button onMouseDown={cancelTextInput} onTouchStart={cancelTextInput} className="bg-red-500 text-white p-1.5 rounded-full shadow"><X size={14} /></button><button onMouseDown={saveTextInput} onTouchStart={saveTextInput} className="bg-green-600 text-white p-1.5 rounded-full shadow"><Check size={14} /></button></div>
                    <div className="absolute -bottom-3 -right-3 w-6 h-6 bg-blue-600 rounded-full border-2 border-white shadow cursor-se-resize z-30 flex items-center justify-center" onMouseDown={(e) => startResize(e, 'text')} onTouchStart={(e) => startResize(e, 'text')}><Maximize size={12} className="text-white" /></div>
                  </div>
                )}

                {/* Image Input Render Logic */}
                {imageInput.isVisible && (
                  <div
                    className="absolute z-20 border-2 border-purple-500 border-dashed"
                    style={{
                      left: imageInput.x, top: imageInput.y,
                      width: imageInput.width, height: imageInput.height,
                      opacity: imageInput.opacity,
                      transform: `rotate(${imageInput.rotation}deg)`
                    }}
                    onMouseDown={(e) => startDrag(e, 'image')}
                    onTouchStart={(e) => startDrag(e, 'image')}
                  >
                    <img src={imageInput.src || imageInput.image?.src} className="w-full h-full object-fill select-none pointer-events-none" />
                    <div className="absolute -top-10 right-0 flex gap-2"><button onMouseDown={() => setImageInput({ ...imageInput, isVisible: false })} onTouchStart={() => setImageInput({ ...imageInput, isVisible: false })} className="bg-red-500 text-white p-1.5 rounded-full shadow"><X size={14} /></button><button onMouseDown={saveImageInput} onTouchStart={saveImageInput} className="bg-green-600 text-white p-1.5 rounded-full shadow"><Check size={14} /></button></div>
                    <div className="absolute -bottom-3 -right-3 w-6 h-6 bg-purple-600 rounded-full border-2 border-white shadow cursor-se-resize z-30 flex items-center justify-center" onMouseDown={(e) => startResize(e, 'image')} onTouchStart={(e) => startResize(e, 'image')}><Maximize size={12} className="text-white" /></div>
                  </div>
                )}
              </div>
            </div>
          ) : (<div className="flex items-center justify-center h-full text-gray-400 text-sm">Tap Upload to open PDF</div>)}
        </div>

        {/* Profile Popup - Keep existing Logic */}
        {showProfile && user && (
          <div className="absolute top-14 right-2 w-64 bg-white shadow-2xl border rounded-xl p-3 z-[60]">
            {/* ... Keep your existing profile popup content ... */}
            <div className="flex justify-between mb-2"><span className="font-bold text-xs">My Assets</span><button onClick={handleLogout} className="text-red-500 text-xs">Sign Out</button></div>
            <label className="block bg-blue-50 border border-dashed border-blue-300 p-2 text-center rounded mb-2 cursor-pointer"><span className="text-xs text-blue-600 font-bold">+ Upload Asset</span><input type="file" onChange={handleProfileUpload} className="hidden" /></label>
            <div className="grid grid-cols-3 gap-1 max-h-40 overflow-auto">
              {savedImages.map((src, i) => (
                <img key={i} src={src} className="w-full h-12 object-contain border bg-white" onClick={() => {
                  /* Add your image loading logic here */
                  const img = new Image(); img.onload = () => { setImageInput({ x: 50, y: 50, width: 100, height: 100 * (img.height / img.width), src: src, image: img, isVisible: true, opacity: 1, rotation: 0, aspectRatio: img.height / img.width }); setTool('cursor'); setShowProfile(false); }; img.src = src;
                }} />
              ))}
            </div>
          </div>
        )}
      </main>

      {/* Reorder Popup - Keep existing */}
      {isReordering && (
        /* ... Keep your existing Reorder Popup code ... */
        <div className="fixed inset-0 bg-black bg-opacity-90 z-[100] flex flex-col p-4">
          <div className="bg-white flex-1 rounded-lg overflow-hidden flex flex-col">
            <div className="p-3 border-b flex justify-between"><h3 className="font-bold">Reorder</h3><button onClick={() => setIsReordering(false)} className="bg-blue-600 text-white px-3 py-1 rounded text-sm">Done</button></div>
            <div className="flex-1 overflow-auto p-4 bg-gray-100">
              <div className="grid grid-cols-3 gap-4">
                {pageOrder.map((pg, idx) => (
                  <div key={idx} draggable onDragStart={() => setDraggedPage(idx)} onDragOver={e => e.preventDefault()} onDrop={e => {
                    e.preventDefault(); const newO = [...pageOrder]; const item = newO[draggedPage]; newO.splice(draggedPage, 1); newO.splice(idx, 0, item); setPageOrder(newO); setDraggedPage(null);
                  }} className="bg-white p-2 text-center border shadow rounded">
                    <div className="text-2xl font-bold text-gray-300">{pg}</div>
                    <div className="text-xs">Pg {idx + 1}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const ToolButton = ({ active, onClick, icon, title, label }) => (
  <button onClick={onClick} title={title} className={`flex flex-col items-center justify-center p-3 rounded-lg transition border ${active ? 'bg-blue-50 border-blue-200 text-blue-600' : 'bg-white border-gray-100 hover:bg-gray-50 text-gray-600'}`}>
    {icon}
    <span className="text-[10px] font-medium mt-1">{label}</span>
  </button>
);

export default App;
