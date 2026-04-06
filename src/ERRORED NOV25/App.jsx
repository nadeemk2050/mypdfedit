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
import { auth, googleProvider, db } from './firebase';
import { Upload, Type, Eraser, Pipette, MousePointer2, Save, Undo, Check, X, Move, Bold, Italic, ChevronLeft, ChevronRight, FileText, Settings, Maximize, Pen, Image as ImageIcon, RotateCw, User, LogIn, LogOut, Trash2, FilePlus } from 'lucide-react';

function App() {
  const [pdfDoc, setPdfDoc] = useState(null);
  const [pageNum, setPageNum] = useState(1);
  const [numPages, setNumPages] = useState(0); 
  const [scale, setScale] = useState(1.5);
  const [tool, setTool] = useState('cursor');
  const [color, setColor] = useState('#000000');
  const [brushSize, setBrushSize] = useState(3);
  const [annotations, setAnnotations] = useState([]); 
  const [fileName, setFileName] = useState('document.pdf');
  const [libsLoaded, setLibsLoaded] = useState(false);
  const [canvasDimensions, setCanvasDimensions] = useState({ width: 0, height: 0 });
  const [isSaving, setIsSaving] = useState(false);
  const [isGrayscale, setIsGrayscale] = useState(false);
  const [deletedPages, setDeletedPages] = useState([]);
  const [extraPages, setExtraPages] = useState(0);
  const [pageBackgrounds, setPageBackgrounds] = useState({});

  // Auth States
  const [user, setUser] = useState(null);
  const [savedImages, setSavedImages] = useState([]);
  const [showProfile, setShowProfile] = useState(false);

  const [textInput, setTextInput] = useState({ 
    x: 0, y: 0, width: 200, height: 40, text: '', isVisible: false,
    fontSize: 20, fontFamily: 'Arial', isBold: false, isItalic: false, id: null, 
    opacity: 1, rotation: 0
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
        const docRef = doc(db, "users", currentUser.uid);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          setSavedImages(docSnap.data().images || []);
        } else {
          try {
            await setDoc(docRef, { images: [] });
            setSavedImages([]);
          } catch (error) {
            console.error("Failed to create user document:", error);
          }
        }
      } else {
        setSavedImages([]);
      }
    });
    return () => unsubscribe();
  }, []);

  const handleLogin = async () => {
    try { await signInWithPopup(auth, googleProvider); } 
    catch (error) { console.error("Login failed:", error); alert("Login failed"); }
  };

  const handleLogout = async () => {
    await signOut(auth);
    setShowProfile(false);
  };

  const handleProfileUpload = (e) => {
    if (!user || !user.uid) return alert("Please Sign In properly to upload assets.");
    const file = e.target.files[0];
    if (!file) return;
    
    if (savedImages.length >= 10) return alert("Limit Reached! You have 10 images already.");
    
    const reader = new FileReader();
    reader.onload = async (event) => {
      const base64 = event.target.result;
      if (base64.length > 1000000) return alert("Image is too big! Please use a smaller logo or signature (under 1MB).");

      try {
        const userRef = doc(db, "users", user.uid);
        // Use setDoc with merge:true so it creates the profile if it's missing
        await setDoc(userRef, { images: arrayUnion(base64) }, { merge: true });
        setSavedImages(prev => [...prev, base64]);
        alert("Success! Image saved to your assets.");
      } catch (error) {
        console.error("Upload failed:", error);
        alert("Could not save. Check console for errors.");
      }
    };
    reader.readAsDataURL(file);
    e.target.value = null;
  };

  const handleFileUpload = async (event) => {
    if (!libsLoaded) return;
    const file = event.target.files[0];
    if (!file) return;
    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const typedarray = new Uint8Array(e.target.result);
        const loadedPdf = await window.pdfjsLib.getDocument(typedarray).promise;
        setPdfDoc(loadedPdf);
        setNumPages(loadedPdf.numPages);
        setPageNum(1);
        setAnnotations([]);
        setDeletedPages([]);
        setExtraPages(0);
        setPageBackgrounds({});
        setTextInput({ ...textInput, isVisible: false });
        setImageInput({ ...imageInput, isVisible: false });
      } catch(error) {
        console.error("Error loading PDF:", error);
        alert("Failed to load PDF. The file may be corrupt or invalid.");
      }
    };
    reader.readAsArrayBuffer(file);
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

  const startDrag = (e, type) => {
    e.stopPropagation(); 
    setActiveDrag(type);
    const boxRect = overlayCanvasRef.current.getBoundingClientRect();
    const target = type === 'text' ? textInput : imageInput;
    setDragOffset({ x: e.clientX - boxRect.left - target.x, y: e.clientY - boxRect.top - target.y });
  };

  const startResize = (e, type) => {
    e.stopPropagation();
    setActiveResize(type);
    const { x, y } = getMousePos(e);
    const target = type === 'text' ? textInput : imageInput;
    setResizeStart({ w: target.width, h: target.height, x: x, y: y });
  };

  const saveImageInput = () => {
    setAnnotations(prev => [...prev, {
      type: 'image', x: imageInput.x, y: imageInput.y, width: imageInput.width, height: imageInput.height,
      src: imageInput.src, 
      image: imageInput.image,
      rotation: imageInput.rotation, opacity: imageInput.opacity,
      page: pageNum, id: imageInput.id || Date.now()
    }]);
    setImageInput({ ...imageInput, isVisible: false });
  };

  const saveTextInput = () => {
    if (textInput.text.trim() !== '') {
      setAnnotations(prev => [...prev, {
        type: 'text', x: textInput.x, y: textInput.y, width: textInput.width, height: textInput.height,
        text: textInput.text, color: color, fontSize: textInput.fontSize, fontFamily: textInput.fontFamily,
        isBold: textInput.isBold, isItalic: textInput.isItalic, page: pageNum, id: textInput.id || Date.now(),
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
    
    const canvas = pdfCanvasRef.current;
    const context = canvas.getContext('2d');
    context.clearRect(0, 0, canvas.width, canvas.height);

    if (deletedPages.includes(pageNum)) {
        context.fillStyle = '#ffebee'; 
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.font = '30px Arial';
        context.fillStyle = 'red';
        context.textAlign = 'center';
        context.fillText("PAGE DELETED", canvas.width / 2, 100);
        return;
    }

    if (pageBackgrounds[pageNum]) {
        const bgImg = new Image();
        bgImg.src = pageBackgrounds[pageNum];
        try {
            await bgImg.decode();
            context.drawImage(bgImg, 0, 0, canvas.width, canvas.height);
        } catch (error) {
            console.error("Failed to load background image:", error);
            context.fillStyle = 'white';
            context.fillRect(0, 0, canvas.width, canvas.height);
        }
    } else {
        context.fillStyle = 'white';
        context.fillRect(0, 0, canvas.width, canvas.height);
    }

    if (pageNum > numPages) {
        return; // This is a new blank page, background is already drawn
    }

    try {
      const page = await pdfDoc.getPage(pageNum);
      const viewport = page.getViewport({ scale });
      
      if (canvas.width !== viewport.width || canvas.height !== viewport.height) {
          setCanvasDimensions({ width: viewport.width, height: viewport.height });
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          // Redraw background if canvas was resized
          if (pageBackgrounds[pageNum]) {
               const bgImg = new Image();
               bgImg.src = pageBackgrounds[pageNum];
               try {
                  await bgImg.decode();
                  context.drawImage(bgImg, 0, 0, canvas.width, canvas.height);
               } catch (error) { console.error("Failed to reload background on resize:", error); }
          } else {
              context.fillStyle = 'white';
              context.fillRect(0, 0, canvas.width, canvas.height);
          }
      }
      
      context.filter = isGrayscale ? 'grayscale(100%)' : 'none';
      const renderContext = { canvasContext: context, viewport: viewport };
      await page.render(renderContext).promise;
      context.filter = 'none';

    } catch (error) {
      console.error(`Failed to render page ${pageNum}:`, error);
      context.fillStyle = '#fce4ec';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.font = '20px Arial';
      context.fillStyle = 'red';
      context.textAlign = 'center';
      context.fillText(`Error rendering page ${pageNum}.`, canvas.width / 2, 100);
    }
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

    const currentAnnotations = annotations.filter(ann => ann.page === pageNum);

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
    // SAFETY CHECK: If canvas is not ready, return 0,0 to prevent crash
    if (!overlayCanvasRef.current) {
      return { x: 0, y: 0 };
    }
    const rect = overlayCanvasRef.current.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
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
    if (!isDrawing && !activeDrag && !activeResize) return;
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
    if (activeDrag) setActiveDrag(null);
    if (activeResize) setActiveResize(null);
    
    if (isDrawing) {
      const { x, y } = getMousePos(e);
      setIsDrawing(false);
      
      if (tool === 'whiteout') {
          const ann = { type: 'whiteout', x: Math.min(startPos.x, x), y: Math.min(startPos.y, y), width: Math.abs(x - startPos.x), height: Math.abs(y - startPos.y), page: pageNum, id: Date.now() };
          setAnnotations(prev => [...prev, ann]);
      } else if (tool === 'pen') {
          setAnnotations(prev => [...prev, { type: 'drawing', points: currentPath, color: color, lineWidth: brushSize, page: pageNum, id: Date.now() }]);
          setCurrentPath([]);
      }
    }
  };

  const handleDownload = async () => {
    if (!window.jspdf || !pdfDoc) return;
    setIsSaving(true);
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit: 'px', hotfixes: ['px_scaling'] });
    let isFirstPage = true;

    for (let i = 1; i <= numPages + extraPages; i++) {
        if (deletedPages.includes(i)) continue;

        if (!isFirstPage) pdf.addPage();
        
        const tempCanvas = document.createElement('canvas');
        const ctx = tempCanvas.getContext('2d');
        let viewport;

        if (i <= numPages) {
            const page = await pdfDoc.getPage(i);
            viewport = page.getViewport({ scale: 1.5 });
        } else {
            viewport = { width: 595 * 1.5, height: 842 * 1.5 }; // A4 @ 1.5 scale
        }
        
        tempCanvas.width = viewport.width;
        tempCanvas.height = viewport.height;

        if(isFirstPage) {
            pdf.internal.pageSize.setWidth(tempCanvas.width);
            pdf.internal.pageSize.setHeight(tempCanvas.height);
        }

        if (pageBackgrounds[i]) {
            const bgImg = new Image();
            bgImg.src = pageBackgrounds[i];
            try {
                await bgImg.decode();
                ctx.drawImage(bgImg, 0, 0, tempCanvas.width, tempCanvas.height);
            } catch (error) {
                console.error(`Failed to load background for page ${i}:`, error);
                ctx.fillStyle = 'white';
                ctx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
            }
        } else {
            ctx.fillStyle = 'white';
            ctx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
        }

        if (isGrayscale) ctx.filter = 'grayscale(100%)';

        if (i <= numPages) {
            const page = await pdfDoc.getPage(i);
            await page.render({ canvasContext: ctx, viewport }).promise;
        }
        
        ctx.filter = 'none';

        const pageAnns = annotations.filter(a => a.page === i);
        pageAnns.forEach(ann => {
            ctx.save();
            ctx.globalAlpha = ann.opacity !== undefined ? ann.opacity : 1;
            if (ann.type === 'text' || ann.type === 'image') {
                const cx = ann.x + ann.width / 2;
                const cy = ann.y + ann.height / 2;
                ctx.translate(cx, cy);
                ctx.rotate((ann.rotation || 0) * Math.PI / 180);
                ctx.translate(-cx, -cy);
            }
            if (ann.type === 'whiteout') {
                ctx.fillStyle = 'white';
                ctx.fillRect(ann.x, ann.y, ann.width, ann.height);
            } else if (ann.type === 'text') {
                const fontStyle = ann.isItalic ? 'italic' : '';
                const fontWeight = ann.isBold ? 'bold' : '';
                ctx.font = `${fontStyle} ${fontWeight} ${ann.fontSize}px "${ann.fontFamily}"`;
                ctx.fillStyle = ann.color;
                ctx.textBaseline = 'top';
                ctx.fillText(ann.text, ann.x + 4, ann.y + 4);
            } else if (ann.type === 'image') {
                if (ann.image) {
                    ctx.drawImage(ann.image, ann.x, ann.y, ann.width, ann.height);
                } else if (ann.src) {
                    // Fallback for saving
                    const img = new Image();
                    img.src = ann.src;
                    ctx.drawImage(img, ann.x, ann.y, ann.width, ann.height);
                }
            } else if (ann.type === 'drawing' && ann.points?.length > 0) {
                ctx.strokeStyle = ann.color;
                ctx.lineWidth = ann.lineWidth;
                ctx.beginPath();
                ctx.moveTo(ann.points[0].x, ann.points[0].y);
                ann.points.forEach(p => ctx.lineTo(p.x, p.y));
                ctx.stroke();
            }
            ctx.restore();
        });

        const imgData = tempCanvas.toDataURL('image/jpeg', 0.75);
        pdf.addImage(imgData, 'JPEG', 0, 0, tempCanvas.width, tempCanvas.height);
        
        isFirstPage = false;
    }
    pdf.save(`edited_${fileName}`);
    setIsSaving(false);
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
    <div className="flex flex-row h-screen bg-gray-100 font-sans" onMouseMove={handleMouseMove} onMouseUp={handleMouseUp}>
      <div className="w-64 bg-white border-r shadow-md flex flex-col z-40">
        <div className="p-4 border-b flex items-center gap-2 text-blue-700 font-bold text-xl"><FileText /> PDF Editor</div>
        <div className="p-4 flex-1 overflow-y-auto">
          {pdfDoc ? (
            <div className="flex flex-col gap-6">
              <div>
                <label className="text-xs font-bold text-gray-500 uppercase mb-2 block">Tools</label>
                <div className="grid grid-cols-2 gap-2">
                   <ToolButton active={tool === 'cursor'} onClick={() => setTool('cursor')} icon={<MousePointer2 size={18} />} title="Select / Edit" label="Select" />
                   <ToolButton active={tool === 'whiteout'} onClick={() => setTool('whiteout')} icon={<Eraser size={18} />} title="Whiteout" label="Erase" />
                   <ToolButton active={tool === 'text'} onClick={() => setTool('text')} icon={<Type size={18} />} title="Add Text" label="Text" />
                   <ToolButton active={tool === 'pen'} onClick={() => setTool('pen')} icon={<Pen size={18} />} title="Free Draw" label="Pen" />
                   <ToolButton active={tool === 'image'} onClick={() => imageInputRef.current.click()} icon={<ImageIcon size={18} />} title="Add Image" label="Image" />
                   <ToolButton active={tool === 'picker'} onClick={() => setTool('picker')} icon={<Pipette size={18} />} title="Pick Color" label="Color Pick" />
                </div>
              </div>
              <div className="border-t pt-4">
                <label className="text-xs font-bold text-gray-500 uppercase mb-2 block">Page Actions</label>
                <button 
                  onClick={() => setIsGrayscale(!isGrayscale)}
                  className={`w-full flex items-center gap-2 p-2 rounded mb-2 text-sm font-medium border ${isGrayscale ? 'bg-gray-800 text-white' : 'bg-white text-gray-700'}`}
                >
                  <div className={`w-4 h-4 rounded-full border ${isGrayscale ? 'bg-gray-400' : 'bg-gradient-to-r from-blue-400 to-red-400'}`}></div>
                  {isGrayscale ? 'B&W Mode ON' : 'Switch to B&W'}
                </button>
                <div className="grid grid-cols-2 gap-2">
                   <button 
                     onClick={() => {
                        setExtraPages(p => p + 1);
                        setPageNum(numPages + extraPages + 1);
                     }} 
                     className="flex flex-col items-center justify-center p-3 rounded-lg bg-blue-50 text-blue-600 border border-blue-200 hover:bg-blue-100"
                   >
                     <FilePlus size={18} />
                     <span className="text-[10px] font-medium mt-1">Add Page</span>
                   </button>
                   <button 
                     onClick={() => {
                        if (pageNum > numPages || confirm(`Are you sure you want to delete Page ${pageNum}?`)) {
                           setDeletedPages(prev => [...prev, pageNum]);
                        }
                     }} 
                     className="flex flex-col items-center justify-center p-3 rounded-lg bg-red-50 text-red-600 border border-red-200 hover:bg-red-100"
                   >
                     <Trash2 size={18} />
                     <span className="text-[10px] font-medium mt-1">Delete Page</span>
                   </button>
                </div>
                {deletedPages.includes(pageNum) && (
                   <button 
                     onClick={() => setDeletedPages(prev => prev.filter(p => p !== pageNum))}
                     className="w-full mt-2 bg-gray-200 hover:bg-gray-300 text-gray-700 p-2 rounded text-xs font-bold"
                   >
                     Undo Delete
                   </button>
                )}
              </div>
              <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
              
              {tool === 'pen' && (
                <div className="bg-gray-50 p-3 rounded-lg border">
                  <span className="text-xs font-bold text-gray-600 block mb-2">Brush Size</span>
                  <input type="range" min="1" max="20" value={brushSize} onChange={(e) => setBrushSize(Number(e.target.value))} className="w-full" />
                </div>
              )}
              
              {(tool === 'text' || textInput.isVisible) && (
                <div className="bg-blue-50 p-3 rounded-lg border border-blue-100">
                  <label className="text-xs font-bold text-blue-600 uppercase mb-2 block"><Settings size={12} /> Text Properties</label>
                  <select className="w-full p-2 rounded border text-sm mb-3" value={textInput.fontFamily} onChange={(e) => setTextInput({...textInput, fontFamily: e.target.value})}>
                    <option>Arial</option><option>Times New Roman</option><option>Courier New</option><option>Brush Script MT</option>
                  </select>
                  <div className="flex gap-2">
                    <button className={`flex-1 p-2 rounded border flex justify-center ${textInput.isBold ? 'bg-blue-600 text-white' : 'bg-white'}`} onClick={() => setTextInput({...textInput, isBold: !textInput.isBold})}><Bold size={16} /></button>
                    <button className={`flex-1 p-2 rounded border flex justify-center ${textInput.isItalic ? 'bg-blue-600 text-white' : 'bg-white'}`} onClick={() => setTextInput({...textInput, isItalic: !textInput.isItalic})}><Italic size={16} /></button>
                  </div>
                </div>
              )}

              {(textInput.isVisible || imageInput.isVisible) && (
                <>
                  <div className="bg-gray-50 p-3 rounded-lg border">
                    <span className="text-xs font-bold text-gray-600 block mb-2">Opacity</span>
                    <input type="range" min="0" max="1" step="0.05" value={textInput.isVisible ? textInput.opacity : imageInput.opacity}
                      onChange={(e) => {
                        const newOpacity = parseFloat(e.target.value);
                        if (textInput.isVisible) setTextInput(prev => ({...prev, opacity: newOpacity}));
                        else setImageInput(prev => ({...prev, opacity: newOpacity}));
                      }} className="w-full" />
                  </div>
                  <div className="bg-gray-50 p-3 rounded-lg border">
                    <span className="text-xs font-bold text-gray-600 block mb-2"><RotateCw size={12} /> Rotation: {(textInput.isVisible ? textInput.rotation : imageInput.rotation)}°</span>
                    <input type="range" min="0" max="360" value={textInput.isVisible ? textInput.rotation : imageInput.rotation}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        if (textInput.isVisible) setTextInput(prev => ({...prev, rotation: val}));
                        else setImageInput(prev => ({...prev, rotation: val}));
                      }} className="w-full" />
                  </div>
                </>
              )}

              <div>
                 <span className="text-xs font-bold text-gray-500 uppercase mb-2 block">Color</span>
                 <div className="flex items-center gap-2 bg-white p-2 rounded border">
                    <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="w-8 h-8" />
                    <span className="text-xs text-gray-600 uppercase">{color}</span>
                 </div>
              </div>

              <div className="mt-auto border-t pt-4">
                 <button onClick={undoLast} className="flex items-center gap-2 w-full p-2 bg-gray-100 hover:bg-gray-200 rounded text-sm text-gray-700 mb-2"><Undo size={16} /> Undo Last</button>
                 <button onClick={handleDownload} disabled={isSaving} className="flex items-center gap-2 w-full p-2 bg-green-600 hover:bg-green-700 text-white rounded text-sm font-bold justify-center">
                  {isSaving ? 'Saving...' : <><Save size={16} /> Save & Download PDF</>}
                 </button>
              </div>
            </div>
          ) : ( <div className="text-center text-gray-400 mt-10 p-4">Please load a PDF file to begin editing.</div> )}
        </div>
      </div>

      <main className="flex-1 flex flex-col h-screen">
           <header className="flex items-center gap-4 p-2 bg-white border-b">
              <button onClick={() => fileInputRef.current.click()} disabled={!libsLoaded} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md text-sm font-medium flex items-center gap-2">
                <Upload size={16} /> {libsLoaded ? 'Upload PDF' : 'Loading Libraries...'}
              </button>

              {pdfDoc && (
                <div className="flex items-center border rounded-md">
                  <button disabled={pageNum <= 1} onClick={() => setPageNum(p => p - 1)} className="p-2 hover:bg-gray-200 disabled:opacity-30"><ChevronLeft size={18}/></button>
                  <span className="px-3 text-sm font-semibold text-gray-700 border-l border-r">Page {pageNum} of {numPages + extraPages}</span>
                  <button disabled={pageNum >= numPages + extraPages} onClick={() => setPageNum(p => p + 1)} className="p-2 hover:bg-gray-200 disabled:opacity-30"><ChevronRight size={18}/></button>
                </div>
              )}
              
              <div className="ml-auto">
                {!user ? (
                  <button onClick={handleLogin} className="bg-gray-800 text-white px-4 py-2 rounded-md text-sm font-medium flex items-center gap-2 hover:bg-black">
                     <LogIn size={16} /> Sign In with Google
                  </button>
                ) : (
                  <div className="relative">
                     <button onClick={() => setShowProfile(!showProfile)} className="bg-green-100 text-green-800 border border-green-200 px-4 py-2 rounded-md text-sm font-bold flex items-center gap-2">
                        <User size={16} /> {user.displayName?.split(' ')[0]}
                     </button>
                     
                     {showProfile && (
                       <div className="absolute right-0 top-12 w-80 bg-white shadow-2xl border-2 border-gray-200 rounded-xl p-4 z-50">
                          <div className="flex justify-between items-center mb-4 border-b pb-2">
                             <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">My Assets ({savedImages.length}/10)</span>
                             <button onClick={handleLogout} className="text-red-500 text-xs font-bold hover:bg-red-50 px-2 py-1 rounded">Sign Out</button>
                          </div>
                          <label className="mb-4 border-2 border-dashed border-blue-300 bg-blue-50 rounded-lg p-3 flex flex-col items-center justify-center cursor-pointer hover:bg-blue-100 transition group">
                             <Upload size={20} className="text-blue-500 mb-1 group-hover:scale-110 transition" />
                             <span className="text-xs font-bold text-blue-600">Upload New Logo / Signature</span>
                             {/* The input is inside the label, so clicking the box automatically clicks the input. No Ref needed! */}
                             <input type="file" accept="image/*" className="hidden" onChange={handleProfileUpload} />
                          </label>

                          <div className="grid grid-cols-3 gap-2 max-h-60 overflow-y-auto">
                             {savedImages.map((src, idx) => (
                                <div key={idx} className="relative group">
                                  <img src={src} className="w-full h-16 object-contain border rounded bg-white cursor-pointer hover:border-blue-500 shadow-sm" 
                                    onClick={() => {
                                       const img = new Image();
                                       img.onload = () => {
                                          const aspectRatio = img.height / img.width;
                                          setImageInput({
                                             x: 100, y: 100, width: 150, height: 150 * aspectRatio,
                                             src: src, image: img, isVisible: true, id: Date.now(), 
                                             aspectRatio: aspectRatio, opacity: 1, rotation: 0
                                          });
                                          setTool('cursor');
                                          setShowProfile(false);
                                       };
                                       img.src = src;
                                    }}
                                  />
                                  <button title="Set as Page Background"
                                    className="absolute -bottom-2 -left-2 bg-blue-600 text-white rounded-full p-1 scale-90 opacity-0 group-hover:opacity-100 transition shadow-md hover:scale-100 z-10"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setPageBackgrounds(prev => ({ ...prev, [pageNum]: src }));
                                      setShowProfile(false);
                                      alert(`Background set for Page ${pageNum}`);
                                    }}
                                  ><FileText size={14} /></button>
                                  <button title="Delete Asset"
                                    className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition shadow-sm hover:scale-110"
                                    onClick={async (e) => {
                                      e.stopPropagation();
                                      if(!confirm("Are you sure you want to delete this image?")) return;
                                      try {
                                        const userRef = doc(db, "users", user.uid);
                                        await updateDoc(userRef, { images: arrayRemove(src) });
                                        setSavedImages(prev => prev.filter(img => img !== src));
                                      } catch (error) {
                                        console.error("Failed to delete image:", error);
                                        alert("Could not delete image. Please try again.");
                                      }
                                    }}
                                  ><X size={12} /></button>
                                </div>
                             ))}
                          </div>
                       </div>
                     )}
                  </div>
                )}
              </div>
           </header>
           <div className="flex-1 overflow-auto bg-gray-200 p-8 flex justify-center relative">
              {pdfDoc ? (
                <div className="relative shadow-2xl bg-white" style={{ width: canvasDimensions.width, height: canvasDimensions.height }}>
                  <canvas ref={pdfCanvasRef} className="absolute top-0 left-0" />
                  <canvas ref={overlayCanvasRef} onMouseDown={handleMouseDown} className={`absolute top-0 left-0 z-10 ${tool === 'cursor' ? 'cursor-default' : tool === 'picker' ? 'cursor-crosshair' : tool === 'text' ? 'cursor-text' : 'cursor-crosshair'}`} />
                  
                  {textInput.isVisible && (
                    <div className="absolute z-20 group" style={{ left: textInput.x, top: textInput.y, width: textInput.width, height: textInput.height, opacity: textInput.opacity, transform: `rotate(${textInput.rotation}deg)`}}>
                      <div className="absolute -top-6 left-0 right-0 h-6 bg-blue-500 rounded-t flex items-center px-2 cursor-move opacity-0 group-hover:opacity-100 transition" onMouseDown={(e) => startDrag(e, 'text')}>
                         <Move size={12} className="text-white mr-auto" />
                         <button onMouseDown={cancelTextInput} className="text-white hover:text-red-200"><X size={12} /></button>
                         <button onMouseDown={saveTextInput} className="text-white hover:text-green-200 ml-1"><Check size={12} /></button>
                      </div>
                      <textarea ref={inputRef} value={textInput.text} onChange={(e) => setTextInput({ ...textInput, text: e.target.value })} className="w-full h-full bg-transparent border-2 border-blue-400 border-dashed outline-none p-1 resize-none" style={{ color: color, fontSize: `${textInput.fontSize}px`, fontFamily: textInput.fontFamily, fontWeight: textInput.isBold ? 'bold' : 'normal', fontStyle: textInput.isItalic ? 'italic' : 'normal' }} placeholder="Type here..." spellCheck="false" />
                      <div className="absolute bottom-0 right-0 w-4 h-4 bg-blue-500 cursor-se-resize flex items-center justify-center rounded-tl opacity-0 group-hover:opacity-100" onMouseDown={(e) => startResize(e, 'text')}><Maximize size={10} className="text-white transform rotate-90" /></div>
                    </div>
                  )}

                  {imageInput.isVisible && (
                    <div className="absolute z-20 group" style={{ left: imageInput.x, top: imageInput.y, width: imageInput.width, height: imageInput.height, opacity: imageInput.opacity, transform: `rotate(${imageInput.rotation}deg)`}}>
                      <div className="absolute -top-6 left-0 right-0 h-6 bg-purple-500 rounded-t flex items-center px-2 cursor-move opacity-0 group-hover:opacity-100 transition" onMouseDown={(e) => startDrag(e, 'image')}>
                         <Move size={12} className="text-white mr-auto" />
                         <button onMouseDown={() => setImageInput({ ...imageInput, isVisible: false })} className="text-white hover:text-red-200"><X size={12} /></button>
                         <button onMouseDown={saveImageInput} className="text-white hover:text-green-200 ml-1"><Check size={12} /></button>
                      </div>
                      <img 
                        src={imageInput.src || (imageInput.image ? imageInput.image.src : "")} 
                        className="w-full h-full border-2 border-purple-400 border-dashed pointer-events-none" 
                        alt="Upload" 
                      />
                      <div className="absolute bottom-0 right-0 w-4 h-4 bg-purple-500 cursor-se-resize flex items-center justify-center rounded-tl opacity-0 group-hover:opacity-100" onMouseDown={(e) => startResize(e, 'image')}>
                        <Maximize size={10} className="text-white transform rotate-90" />
                      </div>
                    </div>
                  )}
                </div>
              ) : ( <div className="flex items-center justify-center h-full text-gray-500">Load a PDF to start editing</div> )}
           </div>
      </main>
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