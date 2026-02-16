// Whiteboard Component
// Canvas-based drawing and text tool for brainstorming and visual notes

import { useState, useCallback, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useConfirmDialog } from '@/hooks/useConfirmDialog';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import {
  Pencil,
  Type,
  Square,
  Circle,
  Minus,
  Undo2,
  Redo2,
  Trash2,
  Download,
  Save,
  MousePointer,
  ArrowUp,
  ArrowDown,
  ChevronsUp,
  ChevronsDown,
  Bold,
  Italic,
  Underline,
  Upload,
} from 'lucide-react';

type Tool = 'select' | 'pencil' | 'text' | 'rectangle' | 'ellipse' | 'line';

interface Point {
  x: number;
  y: number;
}

interface DrawingElement {
  id: string;
  type: 'path' | 'text' | 'rectangle' | 'ellipse' | 'line' | 'image';
  points?: Point[];
  text?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  color: string;
  strokeWidth: number;
  fillColor?: string;
  fontSize?: number;
  fontWeight?: 'normal' | 'bold';
  fontStyle?: 'normal' | 'italic';
  textDecoration?: 'none' | 'underline';
  imageUrl?: string;
  imageData?: string; // base64 data URL for embedded images
}

interface DragState {
  elementId: string;
  startX: number;
  startY: number;
  originalElement: DrawingElement;
}

interface WhiteboardProps {
  onSave?: (data: string) => Promise<void>;
  initialData?: string;
  className?: string;
}

const COLORS = [
  '#000000', '#ffffff', '#ef4444', '#f97316', '#eab308',
  '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899', '#6b7280',
  '#14b8a6', '#f43f5e', '#a855f7', '#0ea5e9', '#84cc16',
];

const STROKE_WIDTHS = [2, 4, 6, 8, 12];

export function Whiteboard({ onSave, initialData, className }: WhiteboardProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [tool, setTool] = useState<Tool>('pencil');
  const [color, setColor] = useState('#000000');
  const [fillColor, setFillColor] = useState<string | null>(null);
  const [strokeWidth, setStrokeWidth] = useState(4);
  const [fontSize, setFontSize] = useState(16);
  const [elements, setElements] = useState<DrawingElement[]>([]);
  const [undoStack, setUndoStack] = useState<DrawingElement[][]>([]);
  const [redoStack, setRedoStack] = useState<DrawingElement[][]>([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentPath, setCurrentPath] = useState<Point[]>([]);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showFillPicker, setShowFillPicker] = useState(false);
  const [textInput, setTextInput] = useState('');
  const [textPosition, setTextPosition] = useState<Point | null>(null);
  const [selectedElement, setSelectedElement] = useState<string | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [resizeHandle, setResizeHandle] = useState<'nw' | 'ne' | 'sw' | 'se' | null>(null);
  const [shapePreview, setShapePreview] = useState<{ start: Point; end: Point } | null>(null);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [editingTextValue, setEditingTextValue] = useState('');
  const [clipboard, setClipboard] = useState<DrawingElement | null>(null);
  const lastSaveRef = useRef<string>('');
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const textInputRef = useRef<HTMLTextAreaElement>(null);

  // Zoom and pan state
  const [zoom, setZoom] = useState(1);
  const [panOffset, setPanOffset] = useState<Point>({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState<Point>({ x: 0, y: 0 });

  // Confirmation dialog
  const { confirm, dialogProps: confirmDialogProps } = useConfirmDialog();

  // Load initial data
  useEffect(() => {
    if (initialData) {
      try {
        const parsed = JSON.parse(initialData);
        if (Array.isArray(parsed)) {
          setElements(parsed);
          lastSaveRef.current = initialData;
        }
      } catch (e) {
        console.error('Failed to parse whiteboard data:', e);
      }
    }
  }, [initialData]);

  // Auto-focus text input when text position is set
  useEffect(() => {
    if (textPosition && textInputRef.current) {
      // Use requestAnimationFrame to ensure DOM is updated and input is rendered
      requestAnimationFrame(() => {
        textInputRef.current?.focus();
        // Also select any existing text for easy replacement
        textInputRef.current?.select();
      });
    }
  }, [textPosition]);

  // Autosave effect
  useEffect(() => {
    if (!onSave) return;

    const currentData = JSON.stringify(elements);
    if (currentData === lastSaveRef.current) return;

    // Clear existing timer
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
    }

    // Set new autosave timer (save after 1 second of no changes)
    autosaveTimerRef.current = setTimeout(async () => {
      await onSave(currentData);
      lastSaveRef.current = currentData;
    }, 1000);

    return () => {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
      }
    };
  }, [elements, onSave]);

  // Render canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas size to match container
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;

    // Clear canvas
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Apply zoom and pan transformations
    ctx.save();
    ctx.translate(panOffset.x, panOffset.y);
    ctx.scale(zoom, zoom);

    // Draw elements
    elements.forEach(element => {
      ctx.strokeStyle = element.color;
      ctx.lineWidth = element.strokeWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // Draw fill if present
      if (element.fillColor) {
        ctx.fillStyle = element.fillColor;
      }

      switch (element.type) {
        case 'path':
          if (element.points && element.points.length > 0) {
            const firstPoint = element.points[0];
            if (firstPoint) {
              ctx.beginPath();
              ctx.moveTo(firstPoint.x, firstPoint.y);
              for (let i = 1; i < element.points.length; i++) {
                const point = element.points[i];
                if (point) {
                  ctx.lineTo(point.x, point.y);
                }
              }
              ctx.stroke();
            }
          }
          break;
        case 'text':
          if (element.text && element.x !== undefined && element.y !== undefined) {
            const textSize = element.fontSize || element.strokeWidth * 4;
            const fontWeight = element.fontWeight || 'normal';
            const fontStyle = element.fontStyle || 'normal';
            ctx.font = `${fontStyle} ${fontWeight} ${textSize}px sans-serif`;
            ctx.fillStyle = element.color;

            // Split text by newlines and render each line
            const lines = element.text.split('\n');
            const lineHeight = textSize * 1.2;

            lines.forEach((line, index) => {
              const yPos = element.y! + (index * lineHeight);

              // Draw text
              ctx.fillText(line, element.x!, yPos);

              // Draw underline if needed
              if (element.textDecoration === 'underline') {
                const textWidth = ctx.measureText(line).width;
                ctx.beginPath();
                ctx.strokeStyle = element.color;
                ctx.lineWidth = Math.max(1, textSize / 16);
                ctx.moveTo(element.x!, yPos + textSize / 8);
                ctx.lineTo(element.x! + textWidth, yPos + textSize / 8);
                ctx.stroke();
              }
            });
          }
          break;
        case 'rectangle':
          if (element.x !== undefined && element.y !== undefined &&
              element.width !== undefined && element.height !== undefined) {
            if (element.fillColor) {
              ctx.fillRect(element.x, element.y, element.width, element.height);
            }
            ctx.strokeRect(element.x, element.y, element.width, element.height);
          }
          break;
        case 'ellipse':
          if (element.x !== undefined && element.y !== undefined &&
              element.width !== undefined && element.height !== undefined) {
            ctx.beginPath();
            ctx.ellipse(
              element.x + element.width / 2,
              element.y + element.height / 2,
              Math.abs(element.width / 2),
              Math.abs(element.height / 2),
              0, 0, Math.PI * 2
            );
            if (element.fillColor) {
              ctx.fill();
            }
            ctx.stroke();
          }
          break;
        case 'line':
          if (element.points && element.points.length >= 2) {
            const start = element.points[0];
            const end = element.points[1];
            if (start && end) {
              ctx.beginPath();
              ctx.moveTo(start.x, start.y);
              ctx.lineTo(end.x, end.y);
              ctx.stroke();
            }
          }
          break;
        case 'image':
          if (element.x !== undefined && element.y !== undefined &&
              element.width !== undefined && element.height !== undefined &&
              element.imageData) {
            const img = new Image();
            img.src = element.imageData;
            // Only draw if image is loaded
            if (img.complete) {
              ctx.drawImage(img, element.x, element.y, element.width, element.height);
            }
          }
          break;
      }

      // Draw selection indicator and resize handles
      if (selectedElement === element.id) {
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        const bounds = getElementBounds(element);
        if (bounds) {
          ctx.strokeRect(bounds.x - 4, bounds.y - 4, bounds.width + 8, bounds.height + 8);

          // Draw resize handles for shapes (not for paths or lines)
          if (element.type === 'rectangle' || element.type === 'ellipse' || element.type === 'text' || element.type === 'image') {
            ctx.setLineDash([]);
            ctx.fillStyle = '#3b82f6';
            const handleSize = 8;
            const handles = [
              { x: bounds.x - 4, y: bounds.y - 4 }, // nw
              { x: bounds.x + bounds.width + 4, y: bounds.y - 4 }, // ne
              { x: bounds.x - 4, y: bounds.y + bounds.height + 4 }, // sw
              { x: bounds.x + bounds.width + 4, y: bounds.y + bounds.height + 4 }, // se
            ];
            handles.forEach(handle => {
              ctx.fillRect(handle.x - handleSize / 2, handle.y - handleSize / 2, handleSize, handleSize);
            });
          }
        }
        ctx.setLineDash([]);
      }
    });

    // Draw shape preview during drawing
    if (shapePreview && (tool === 'rectangle' || tool === 'ellipse' || tool === 'line')) {
      ctx.strokeStyle = color;
      ctx.lineWidth = strokeWidth;
      ctx.setLineDash([4, 4]);

      const { start, end } = shapePreview;
      const x = Math.min(start.x, end.x);
      const y = Math.min(start.y, end.y);
      const width = Math.abs(end.x - start.x);
      const height = Math.abs(end.y - start.y);

      if (tool === 'rectangle') {
        if (fillColor) {
          ctx.fillStyle = fillColor;
          ctx.fillRect(x, y, width, height);
        }
        ctx.strokeRect(x, y, width, height);
      } else if (tool === 'ellipse') {
        ctx.beginPath();
        ctx.ellipse(x + width / 2, y + height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
        if (fillColor) {
          ctx.fillStyle = fillColor;
          ctx.fill();
        }
        ctx.stroke();
      } else if (tool === 'line') {
        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(end.x, end.y);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    // Draw current path (pencil)
    if (isDrawing && currentPath.length > 0 && tool === 'pencil') {
      const firstPoint = currentPath[0];
      if (firstPoint) {
        ctx.strokeStyle = color;
        ctx.lineWidth = strokeWidth;
        ctx.beginPath();
        ctx.moveTo(firstPoint.x, firstPoint.y);
        for (let i = 1; i < currentPath.length; i++) {
          const point = currentPath[i];
          if (point) {
            ctx.lineTo(point.x, point.y);
          }
        }
        ctx.stroke();
      }
    }

    // Restore context after transformation
    ctx.restore();
  }, [elements, isDrawing, currentPath, color, strokeWidth, selectedElement, shapePreview, tool, fillColor, zoom, panOffset]);

  // Helper to get element bounds
  const getElementBounds = useCallback((element: DrawingElement): { x: number; y: number; width: number; height: number } | null => {
    switch (element.type) {
      case 'rectangle':
      case 'ellipse':
      case 'image':
        if (element.x !== undefined && element.y !== undefined &&
            element.width !== undefined && element.height !== undefined) {
          return { x: element.x, y: element.y, width: element.width, height: element.height };
        }
        break;
      case 'text':
        if (element.x !== undefined && element.y !== undefined && element.text) {
          const fontSize = element.fontSize || element.strokeWidth * 4;
          const lines = element.text.split('\n');
          const lineHeight = fontSize * 1.2;
          // Calculate the maximum line width
          const maxLineWidth = Math.max(...lines.map(line => line.length * fontSize * 0.6));
          const totalHeight = lines.length * lineHeight;
          return {
            x: element.x,
            y: element.y - fontSize,
            width: maxLineWidth,
            height: totalHeight
          };
        }
        break;
      case 'line':
      case 'path':
        if (element.points && element.points.length > 0) {
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          for (const p of element.points) {
            minX = Math.min(minX, p.x);
            minY = Math.min(minY, p.y);
            maxX = Math.max(maxX, p.x);
            maxY = Math.max(maxY, p.y);
          }
          return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
        }
        break;
    }
    return null;
  }, []);

  // Check if a point is inside an element
  const isPointInElement = useCallback((point: Point, element: DrawingElement): boolean => {
    const bounds = getElementBounds(element);
    if (!bounds) return false;
    const padding = 8;
    return point.x >= bounds.x - padding &&
           point.x <= bounds.x + bounds.width + padding &&
           point.y >= bounds.y - padding &&
           point.y <= bounds.y + bounds.height + padding;
  }, [getElementBounds]);

  // Check if point is on a resize handle
  const getResizeHandle = useCallback((point: Point, element: DrawingElement): 'nw' | 'ne' | 'sw' | 'se' | null => {
    if (element.type !== 'rectangle' && element.type !== 'ellipse' && element.type !== 'text' && element.type !== 'image') {
      return null;
    }
    const bounds = getElementBounds(element);
    if (!bounds) return null;

    const handleSize = 8;
    const handles = [
      { name: 'nw' as const, x: bounds.x - 4, y: bounds.y - 4 },
      { name: 'ne' as const, x: bounds.x + bounds.width + 4, y: bounds.y - 4 },
      { name: 'sw' as const, x: bounds.x - 4, y: bounds.y + bounds.height + 4 },
      { name: 'se' as const, x: bounds.x + bounds.width + 4, y: bounds.y + bounds.height + 4 },
    ];

    for (const handle of handles) {
      if (Math.abs(point.x - handle.x) <= handleSize / 2 &&
          Math.abs(point.y - handle.y) <= handleSize / 2) {
        return handle.name;
      }
    }
    return null;
  }, [getElementBounds]);

  const getCanvasPoint = useCallback((e: React.MouseEvent<HTMLCanvasElement>): Point => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    // Transform screen coordinates to canvas coordinates accounting for zoom and pan
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    return {
      x: (screenX - panOffset.x) / zoom,
      y: (screenY - panOffset.y) / zoom,
    };
  }, [zoom, panOffset]);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    // Check for space key for panning
    if (e.nativeEvent.which === 1 && (e.nativeEvent as MouseEvent & { spaceKey?: boolean }).spaceKey) {
      setIsPanning(true);
      setPanStart({ x: e.clientX - panOffset.x, y: e.clientY - panOffset.y });
      return;
    }

    const point = getCanvasPoint(e);

    if (tool === 'select') {
      // Check if clicking on resize handle of selected element
      if (selectedElement) {
        const el = elements.find(e => e.id === selectedElement);
        if (el) {
          const handle = getResizeHandle(point, el);
          if (handle) {
            setResizeHandle(handle);
            setDragState({
              elementId: el.id,
              startX: point.x,
              startY: point.y,
              originalElement: { ...el },
            });
            return;
          }
        }
      }

      // Find element under cursor (check from top to bottom)
      let found: DrawingElement | null = null;
      for (let i = elements.length - 1; i >= 0; i--) {
        const el = elements[i];
        if (el && isPointInElement(point, el)) {
          found = el;
          break;
        }
      }

      if (found) {
        setSelectedElement(found.id);
        setDragState({
          elementId: found.id,
          startX: point.x,
          startY: point.y,
          originalElement: { ...found },
        });
      } else {
        setSelectedElement(null);
      }
      return;
    }

    if (tool === 'text') {
      setTextPosition(point);
      return;
    }

    // For shapes, start preview
    if (tool === 'rectangle' || tool === 'ellipse' || tool === 'line') {
      setShapePreview({ start: point, end: point });
      // Save current state for undo
      setUndoStack(prev => [...prev, elements]);
      setRedoStack([]);
      return;
    }

    setIsDrawing(true);
    setCurrentPath([point]);

    // Save current state for undo
    setUndoStack(prev => [...prev, elements]);
    setRedoStack([]);
  }, [tool, elements, getCanvasPoint, isPointInElement, isPanning, panStart, panOffset]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    // Handle panning
    if (isPanning) {
      setPanOffset({
        x: e.clientX - panStart.x,
        y: e.clientY - panStart.y,
      });
      return;
    }

    const point = getCanvasPoint(e);

    // Handle dragging selected element or resizing
    if (dragState) {
      const dx = point.x - dragState.startX;
      const dy = point.y - dragState.startY;
      const original = dragState.originalElement;

      setElements(prev => prev.map(el => {
        if (el.id !== dragState.elementId) return el;

        // Handle resizing
        if (resizeHandle && (el.type === 'rectangle' || el.type === 'ellipse' || el.type === 'text' || el.type === 'image')) {
          const origX = original.x ?? 0;
          const origY = original.y ?? 0;
          const origWidth = original.width ?? 0;
          const origHeight = original.height ?? 0;

          let newX = origX;
          let newY = origY;
          let newWidth = origWidth;
          let newHeight = origHeight;

          switch (resizeHandle) {
            case 'nw':
              newX = origX + dx;
              newY = origY + dy;
              newWidth = origWidth - dx;
              newHeight = origHeight - dy;
              break;
            case 'ne':
              newY = origY + dy;
              newWidth = origWidth + dx;
              newHeight = origHeight - dy;
              break;
            case 'sw':
              newX = origX + dx;
              newWidth = origWidth - dx;
              newHeight = origHeight + dy;
              break;
            case 'se':
              newWidth = origWidth + dx;
              newHeight = origHeight + dy;
              break;
          }

          // Ensure minimum size
          if (Math.abs(newWidth) < 10) newWidth = 10 * Math.sign(newWidth || 1);
          if (Math.abs(newHeight) < 10) newHeight = 10 * Math.sign(newHeight || 1);

          // For text elements, update fontSize based on height
          if (el.type === 'text') {
            const newFontSize = Math.max(8, Math.abs(newHeight));
            return {
              ...el,
              x: newX,
              y: newY,
              width: newWidth,
              height: newHeight,
              fontSize: newFontSize,
            };
          }

          return {
            ...el,
            x: newX,
            y: newY,
            width: newWidth,
            height: newHeight,
          };
        }

        // Move element based on type
        if (el.type === 'rectangle' || el.type === 'ellipse' || el.type === 'text' || el.type === 'image') {
          return {
            ...el,
            x: (original.x ?? 0) + dx,
            y: (original.y ?? 0) + dy,
          };
        } else if (el.type === 'line' || el.type === 'path') {
          const originalPoints = original.points ?? [];
          return {
            ...el,
            points: originalPoints.map(p => ({ x: p.x + dx, y: p.y + dy })),
          };
        }
        return el;
      }));
      return;
    }

    // Handle shape preview
    if (shapePreview) {
      setShapePreview(prev => prev ? { ...prev, end: point } : null);
      return;
    }

    if (!isDrawing) return;
    setCurrentPath(prev => [...prev, point]);
  }, [isDrawing, getCanvasPoint, dragState, shapePreview, isPanning, panStart]);

  // Handle double-click to edit text
  const handleDoubleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (tool !== 'select') return;

    const point = getCanvasPoint(e);

    // Find text element under cursor
    for (let i = elements.length - 1; i >= 0; i--) {
      const el = elements[i];
      if (el && el.type === 'text' && isPointInElement(point, el)) {
        // Enter edit mode for this text element
        setEditingTextId(el.id);
        setEditingTextValue(el.text ?? '');
        setSelectedElement(el.id);
        return;
      }
    }
  }, [tool, elements, getCanvasPoint, isPointInElement]);

  // Handle text edit submission
  const handleTextEditSubmit = useCallback(() => {
    if (!editingTextId) return;

    if (editingTextValue.trim()) {
      // Update the text element
      setUndoStack(prev => [...prev, elements]);
      setRedoStack([]);
      setElements(prev => prev.map(el =>
        el.id === editingTextId ? { ...el, text: editingTextValue } : el
      ));
    } else {
      // Remove empty text element
      setUndoStack(prev => [...prev, elements]);
      setRedoStack([]);
      setElements(prev => prev.filter(el => el.id !== editingTextId));
    }

    setEditingTextId(null);
    setEditingTextValue('');
  }, [editingTextId, editingTextValue, elements]);

  const handleMouseUp = useCallback(() => {
    // Handle end of pan
    if (isPanning) {
      setIsPanning(false);
      return;
    }

    // Reset resize handle
    setResizeHandle(null);

    // Handle end of drag
    if (dragState) {
      // Save undo state for drag
      setUndoStack(prev => [...prev, elements.map(el =>
        el.id === dragState.elementId ? dragState.originalElement : el
      )]);
      setRedoStack([]);
      setDragState(null);
      return;
    }

    // Handle shape creation from preview
    if (shapePreview) {
      const { start, end } = shapePreview;
      const width = Math.abs(end.x - start.x);
      const height = Math.abs(end.y - start.y);

      // Only create if shape has some size
      if (width > 5 || height > 5) {
        let newElement: DrawingElement;

        if (tool === 'rectangle') {
          const rectElement: DrawingElement = {
            id: `el_${Date.now()}`,
            type: 'rectangle',
            x: Math.min(start.x, end.x),
            y: Math.min(start.y, end.y),
            width,
            height,
            color,
            strokeWidth,
          };
          if (fillColor) rectElement.fillColor = fillColor;
          setElements(prev => [...prev, rectElement]);
        } else if (tool === 'ellipse') {
          const ellipseElement: DrawingElement = {
            id: `el_${Date.now()}`,
            type: 'ellipse',
            x: Math.min(start.x, end.x),
            y: Math.min(start.y, end.y),
            width,
            height,
            color,
            strokeWidth,
          };
          if (fillColor) ellipseElement.fillColor = fillColor;
          setElements(prev => [...prev, ellipseElement]);
        } else if (tool === 'line') {
          newElement = {
            id: `el_${Date.now()}`,
            type: 'line',
            points: [start, end],
            color,
            strokeWidth,
          };
          setElements(prev => [...prev, newElement]);
        }

        // Auto-switch to select tool after creating shape
        setTool('select');
      }

      setShapePreview(null);
      return;
    }

    if (!isDrawing) return;
    setIsDrawing(false);

    if (currentPath.length > 0) {
      let newElement: DrawingElement;

      if (tool === 'pencil') {
        newElement = {
          id: `el_${Date.now()}`,
          type: 'path',
          points: currentPath,
          color,
          strokeWidth,
        };
      } else if (tool === 'line' && currentPath.length >= 2) {
        const lineStart = currentPath[0];
        const lineEnd = currentPath[currentPath.length - 1];
        if (lineStart && lineEnd) {
          newElement = {
            id: `el_${Date.now()}`,
            type: 'line',
            points: [lineStart, lineEnd],
            color,
            strokeWidth,
          };
        } else {
          setCurrentPath([]);
          return;
        }
      } else if (tool === 'rectangle' && currentPath.length >= 2) {
        const rectStart = currentPath[0];
        const rectEnd = currentPath[currentPath.length - 1];
        if (rectStart && rectEnd) {
          newElement = {
            id: `el_${Date.now()}`,
            type: 'rectangle',
            x: Math.min(rectStart.x, rectEnd.x),
            y: Math.min(rectStart.y, rectEnd.y),
            width: Math.abs(rectEnd.x - rectStart.x),
            height: Math.abs(rectEnd.y - rectStart.y),
            color,
            strokeWidth,
          };
          if (fillColor) newElement.fillColor = fillColor;
        } else {
          setCurrentPath([]);
          return;
        }
      } else if (tool === 'ellipse' && currentPath.length >= 2) {
        const ellipseStart = currentPath[0];
        const ellipseEnd = currentPath[currentPath.length - 1];
        if (ellipseStart && ellipseEnd) {
          newElement = {
            id: `el_${Date.now()}`,
            type: 'ellipse',
            x: Math.min(ellipseStart.x, ellipseEnd.x),
            y: Math.min(ellipseStart.y, ellipseEnd.y),
            width: Math.abs(ellipseEnd.x - ellipseStart.x),
            height: Math.abs(ellipseEnd.y - ellipseStart.y),
            color,
            strokeWidth,
          };
          if (fillColor) newElement.fillColor = fillColor;
        } else {
          setCurrentPath([]);
          return;
        }
      } else {
        setCurrentPath([]);
        return;
      }

      setElements(prev => [...prev, newElement]);

      // Auto-switch to select tool after creating element
      setTool('select');
    }
    setCurrentPath([]);
  }, [isDrawing, currentPath, tool, color, strokeWidth, fillColor, dragState, shapePreview, elements, isPanning]);

  const handleTextSubmit = useCallback(() => {
    if (!textInput || !textPosition) return;

    const newElement: DrawingElement = {
      id: `el_${Date.now()}`,
      type: 'text',
      text: textInput,
      x: textPosition.x,
      y: textPosition.y,
      color,
      strokeWidth,
      fontSize,
    };

    setUndoStack(prev => [...prev, elements]);
    setRedoStack([]);
    setElements(prev => [...prev, newElement]);
    setTextInput('');
    setTextPosition(null);

    // Auto-switch to select tool after creating text
    setTool('select');
  }, [textInput, textPosition, color, strokeWidth, fontSize, elements]);

  const handleUndo = useCallback(() => {
    if (undoStack.length === 0) return;
    const previousState = undoStack[undoStack.length - 1];
    if (previousState) {
      setRedoStack(prev => [...prev, elements]);
      setElements(previousState);
      setUndoStack(prev => prev.slice(0, -1));
    }
  }, [undoStack, elements]);

  const handleRedo = useCallback(() => {
    if (redoStack.length === 0) return;
    const nextState = redoStack[redoStack.length - 1];
    if (nextState) {
      setUndoStack(prev => [...prev, elements]);
      setElements(nextState);
      setRedoStack(prev => prev.slice(0, -1));
    }
  }, [redoStack, elements]);

  const handleBringForward = useCallback(() => {
    if (!selectedElement) return;
    const index = elements.findIndex(el => el.id === selectedElement);
    if (index === -1 || index === elements.length - 1) return;

    setUndoStack(prev => [...prev, elements]);
    setRedoStack([]);
    const newElements = [...elements];
    const [element] = newElements.splice(index, 1);
    if (element) {
      newElements.splice(index + 1, 0, element);
      setElements(newElements);
    }
  }, [selectedElement, elements]);

  const handleSendBackward = useCallback(() => {
    if (!selectedElement) return;
    const index = elements.findIndex(el => el.id === selectedElement);
    if (index === -1 || index === 0) return;

    setUndoStack(prev => [...prev, elements]);
    setRedoStack([]);
    const newElements = [...elements];
    const [element] = newElements.splice(index, 1);
    if (element) {
      newElements.splice(index - 1, 0, element);
      setElements(newElements);
    }
  }, [selectedElement, elements]);

  const handleBringToFront = useCallback(() => {
    if (!selectedElement) return;
    const index = elements.findIndex(el => el.id === selectedElement);
    if (index === -1 || index === elements.length - 1) return;

    setUndoStack(prev => [...prev, elements]);
    setRedoStack([]);
    const newElements = [...elements];
    const [element] = newElements.splice(index, 1);
    if (element) {
      newElements.push(element);
      setElements(newElements);
    }
  }, [selectedElement, elements]);

  const handleSendToBack = useCallback(() => {
    if (!selectedElement) return;
    const index = elements.findIndex(el => el.id === selectedElement);
    if (index === -1 || index === 0) return;

    setUndoStack(prev => [...prev, elements]);
    setRedoStack([]);
    const newElements = [...elements];
    const [element] = newElements.splice(index, 1);
    if (element) {
      newElements.unshift(element);
      setElements(newElements);
    }
  }, [selectedElement, elements]);

  const handleChangeStrokeColor = useCallback((newColor: string) => {
    if (!selectedElement) return;
    setUndoStack(prev => [...prev, elements]);
    setRedoStack([]);
    setElements(prev => prev.map(el =>
      el.id === selectedElement ? { ...el, color: newColor } : el
    ));
  }, [selectedElement, elements]);

  const handleChangeFillColor = useCallback((newFillColor: string | null) => {
    if (!selectedElement) return;
    const element = elements.find(el => el.id === selectedElement);
    if (!element || (element.type !== 'rectangle' && element.type !== 'ellipse')) return;

    setUndoStack(prev => [...prev, elements]);
    setRedoStack([]);
    setElements(prev => prev.map(el => {
      if (el.id !== selectedElement) return el;
      if (newFillColor === null) {
        const { fillColor, ...rest } = el;
        return rest;
      }
      return { ...el, fillColor: newFillColor };
    }));
  }, [selectedElement, elements]);

  const handleChangeFontSize = useCallback((newSize: number) => {
    if (!selectedElement) return;
    const element = elements.find(el => el.id === selectedElement);
    if (!element || element.type !== 'text') return;

    setUndoStack(prev => [...prev, elements]);
    setRedoStack([]);
    setElements(prev => prev.map(el =>
      el.id === selectedElement ? { ...el, fontSize: newSize } : el
    ));
  }, [selectedElement, elements]);

  const handleToggleBold = useCallback(() => {
    if (!selectedElement) return;
    const element = elements.find(el => el.id === selectedElement);
    if (!element || element.type !== 'text') return;

    setUndoStack(prev => [...prev, elements]);
    setRedoStack([]);
    setElements(prev => prev.map(el =>
      el.id === selectedElement
        ? { ...el, fontWeight: el.fontWeight === 'bold' ? 'normal' : 'bold' }
        : el
    ));
  }, [selectedElement, elements]);

  const handleToggleItalic = useCallback(() => {
    if (!selectedElement) return;
    const element = elements.find(el => el.id === selectedElement);
    if (!element || element.type !== 'text') return;

    setUndoStack(prev => [...prev, elements]);
    setRedoStack([]);
    setElements(prev => prev.map(el =>
      el.id === selectedElement
        ? { ...el, fontStyle: el.fontStyle === 'italic' ? 'normal' : 'italic' }
        : el
    ));
  }, [selectedElement, elements]);

  const handleToggleUnderline = useCallback(() => {
    if (!selectedElement) return;
    const element = elements.find(el => el.id === selectedElement);
    if (!element || element.type !== 'text') return;

    setUndoStack(prev => [...prev, elements]);
    setRedoStack([]);
    setElements(prev => prev.map(el =>
      el.id === selectedElement
        ? { ...el, textDecoration: el.textDecoration === 'underline' ? 'none' : 'underline' }
        : el
    ));
  }, [selectedElement, elements]);

  // Keyboard shortcut handler for whiteboard
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle if whiteboard is focused (container or canvas has focus)
      const container = containerRef.current;
      if (!container || !container.contains(document.activeElement)) return;

      // Skip if editing text
      if (editingTextId || textPosition) return;

      const isMod = e.ctrlKey || e.metaKey;

      // Tool shortcuts (V = select, T = text) - only without modifiers
      if (!isMod && !e.shiftKey && !e.altKey) {
        if (e.key.toLowerCase() === 'v') {
          e.preventDefault();
          setTool('select');
          return;
        }
        if (e.key.toLowerCase() === 't') {
          e.preventDefault();
          setTool('text');
          return;
        }
      }

      // Undo: Ctrl+Z
      if (isMod && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
        return;
      }

      // Redo: Ctrl+Y or Ctrl+Shift+Z
      if ((isMod && e.key === 'y') || (isMod && e.shiftKey && e.key === 'z')) {
        e.preventDefault();
        handleRedo();
        return;
      }

      // Delete selected element: Delete or Backspace
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedElement) {
        e.preventDefault();
        setUndoStack(prev => [...prev, elements]);
        setRedoStack([]);
        setElements(prev => prev.filter(el => el.id !== selectedElement));
        setSelectedElement(null);
        return;
      }

      // Copy: Ctrl+C
      if (isMod && e.key === 'c' && selectedElement) {
        e.preventDefault();
        const el = elements.find(e => e.id === selectedElement);
        if (el) {
          setClipboard({ ...el });
        }
        return;
      }

      // Cut: Ctrl+X
      if (isMod && e.key === 'x' && selectedElement) {
        e.preventDefault();
        const el = elements.find(e => e.id === selectedElement);
        if (el) {
          setClipboard({ ...el });
          setUndoStack(prev => [...prev, elements]);
          setRedoStack([]);
          setElements(prev => prev.filter(e => e.id !== selectedElement));
          setSelectedElement(null);
        }
        return;
      }

      // Paste: Ctrl+V
      if (isMod && e.key === 'v' && clipboard) {
        e.preventDefault();
        // Create a new element with offset position
        const newElement: DrawingElement = {
          ...clipboard,
          id: `el_${Date.now()}`,
        };
        // Offset the pasted element slightly
        if (newElement.x !== undefined) newElement.x += 20;
        if (newElement.y !== undefined) newElement.y += 20;
        if (newElement.points) {
          newElement.points = newElement.points.map(p => ({ x: p.x + 20, y: p.y + 20 }));
        }
        setUndoStack(prev => [...prev, elements]);
        setRedoStack([]);
        setElements(prev => [...prev, newElement]);
        setSelectedElement(newElement.id);
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleUndo, handleRedo, selectedElement, elements, editingTextId, textPosition, clipboard]);

  // Zoom and pan handlers
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let spacePressed = false;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !spacePressed) {
        spacePressed = true;
        canvas.style.cursor = 'grab';
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spacePressed = false;
        setIsPanning(false);
        canvas.style.cursor = '';
      }
    };

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      // Calculate new zoom
      const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
      const newZoom = Math.max(0.1, Math.min(5, zoom * zoomFactor));

      // Adjust pan to zoom toward mouse position
      const scaleFactor = newZoom / zoom;
      setPanOffset({
        x: mouseX - (mouseX - panOffset.x) * scaleFactor,
        y: mouseY - (mouseY - panOffset.y) * scaleFactor,
      });
      setZoom(newZoom);
    };

    const handleCanvasMouseDown = (e: MouseEvent) => {
      if (spacePressed) {
        (e as MouseEvent & { spaceKey?: boolean }).spaceKey = true;
        canvas.style.cursor = 'grabbing';
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    canvas.addEventListener('mousedown', handleCanvasMouseDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      canvas.removeEventListener('wheel', handleWheel);
      canvas.removeEventListener('mousedown', handleCanvasMouseDown);
    };
  }, [zoom, panOffset]);

  const handleClear = useCallback(async () => {
    const confirmed = await confirm('Clear the whiteboard?', {
      title: 'Clear Whiteboard',
      variant: 'destructive',
      confirmLabel: 'Clear',
    });
    if (confirmed) {
      setUndoStack(prev => [...prev, elements]);
      setRedoStack([]);
      setElements([]);
    }
  }, [elements, confirm]);

  // Manual save handler
  const _handleSave = useCallback(async () => {
    if (onSave) {
      const data = JSON.stringify(elements);
      await onSave(data);
      lastSaveRef.current = data;
    }
  }, [elements, onSave]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImageUpload = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const imageData = e.target?.result as string;
      const img = new Image();
      img.onload = () => {
        const maxWidth = 400;
        const maxHeight = 400;
        let width = img.width;
        let height = img.height;

        if (width > maxWidth || height > maxHeight) {
          const ratio = Math.min(maxWidth / width, maxHeight / height);
          width = width * ratio;
          height = height * ratio;
        }

        const newElement: DrawingElement = {
          id: `el_${Date.now()}`,
          type: 'image',
          x: 50,
          y: 50,
          width,
          height,
          color: '#000000',
          strokeWidth: 2,
          imageData,
        };

        setUndoStack(prev => [...prev, elements]);
        setRedoStack([]);
        setElements(prev => [...prev, newElement]);
      };
      img.src = imageData;
    };
    reader.readAsDataURL(file);
  }, [elements]);

  const handlePaste = useCallback((e: ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item && item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          handleImageUpload(file);
        }
      }
    }
  }, [handleImageUpload]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const file = files[0];
      if (file && file.type.startsWith('image/')) {
        handleImageUpload(file);
      }
    }
  }, [handleImageUpload]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  // Add paste listener
  useEffect(() => {
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [handlePaste]);

  const handleExport = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const link = document.createElement('a');
    link.download = `whiteboard_${Date.now()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  }, []);

  const tools = [
    { id: 'select' as Tool, icon: MousePointer, label: 'Select (V)' },
    { id: 'pencil' as Tool, icon: Pencil, label: 'Pencil' },
    { id: 'text' as Tool, icon: Type, label: 'Text (T)' },
    { id: 'line' as Tool, icon: Minus, label: 'Line' },
    { id: 'rectangle' as Tool, icon: Square, label: 'Rectangle' },
    { id: 'ellipse' as Tool, icon: Circle, label: 'Ellipse' },
  ];

  return (
    <div ref={containerRef} className={cn('flex flex-col h-full', className)} tabIndex={-1}>
      {/* Toolbar */}
      <div className="flex items-center gap-1 p-2 border-b bg-muted/30 flex-wrap">
        {/* Tool buttons */}
        {tools.map(t => (
          <Button
            key={t.id}
            variant={tool === t.id ? 'secondary' : 'ghost'}
            size="sm"
            className="h-8 w-8 p-0"
            onClick={() => setTool(t.id)}
            title={t.label}
          >
            <t.icon className="h-4 w-4" />
          </Button>
        ))}

        <div className="w-px h-6 bg-border mx-1" />

        {/* Stroke color picker */}
        <div className="relative">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2 gap-1"
            onClick={() => { setShowColorPicker(!showColorPicker); setShowFillPicker(false); }}
            title="Stroke Color"
          >
            <div className="w-4 h-4 rounded border border-gray-400" style={{ backgroundColor: color }} />
            <span className="text-xs">Stroke</span>
          </Button>
          {showColorPicker && (
            <div className="absolute top-full left-0 mt-1 p-4 bg-card border rounded-lg shadow-lg z-50 min-w-[240px]">
              <div className="text-xs font-medium mb-3 text-muted-foreground">Stroke Color</div>
              <div className="grid grid-cols-5 gap-3">
                {COLORS.map(c => (
                  <button
                    key={c}
                    className={cn(
                      'w-9 h-9 rounded border-2 transition-transform hover:scale-110',
                      color === c ? 'border-primary ring-2 ring-primary/30' : 'border-gray-300'
                    )}
                    style={{ backgroundColor: c }}
                    onClick={() => {
                      setColor(c);
                      setShowColorPicker(false);
                    }}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Fill color picker (for shapes) */}
        <div className="relative">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2 gap-1"
            onClick={() => { setShowFillPicker(!showFillPicker); setShowColorPicker(false); }}
            title="Fill Color"
          >
            <div
              className="w-4 h-4 rounded border border-gray-400"
              style={{ backgroundColor: fillColor ?? 'transparent' }}
            >
              {!fillColor && <div className="w-full h-full flex items-center justify-center text-gray-400 text-xs">∅</div>}
            </div>
            <span className="text-xs">Fill</span>
          </Button>
          {showFillPicker && (
            <div className="absolute top-full left-0 mt-1 p-4 bg-card border rounded-lg shadow-lg z-50 min-w-[240px]">
              <div className="text-xs font-medium mb-3 text-muted-foreground">Fill Color</div>
              <div className="grid grid-cols-5 gap-3">
                <button
                  className={cn(
                    'w-9 h-9 rounded border-2 transition-transform hover:scale-110 flex items-center justify-center',
                    fillColor === null ? 'border-primary ring-2 ring-primary/30' : 'border-gray-300'
                  )}
                  onClick={() => {
                    setFillColor(null);
                    setShowFillPicker(false);
                  }}
                  title="No fill"
                >
                  <span className="text-gray-400 text-xs">∅</span>
                </button>
                {COLORS.map(c => (
                  <button
                    key={c}
                    className={cn(
                      'w-9 h-9 rounded border-2 transition-transform hover:scale-110',
                      fillColor === c ? 'border-primary ring-2 ring-primary/30' : 'border-gray-300'
                    )}
                    style={{ backgroundColor: c }}
                    onClick={() => {
                      setFillColor(c);
                      setShowFillPicker(false);
                    }}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="w-px h-6 bg-border mx-1" />

        {/* Stroke width */}
        <div className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground mr-1">Width:</span>
          {STROKE_WIDTHS.map(w => (
            <Button
              key={w}
              variant={strokeWidth === w ? 'secondary' : 'ghost'}
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => setStrokeWidth(w)}
              title={`${w}px`}
            >
              <div
                className="rounded-full bg-current"
                style={{ width: Math.min(w, 10), height: Math.min(w, 10) }}
              />
            </Button>
          ))}
        </div>

        <div className="w-px h-6 bg-border mx-1" />

        {/* Font size control for text tool */}
        {tool === 'text' && (
          <>
            <div className="flex items-center gap-1">
              <span className="text-xs text-muted-foreground mr-1">Font:</span>
              <select
                value={fontSize}
                onChange={(e) => setFontSize(Number(e.target.value))}
                className="h-8 text-xs border rounded px-2 bg-background"
              >
                <option value="12">12px (Body)</option>
                <option value="16">16px (Body)</option>
                <option value="20">20px (H3)</option>
                <option value="24">24px (H2)</option>
                <option value="32">32px (H1)</option>
                <option value="48">48px (Title)</option>
                <option value="64">64px (Hero)</option>
              </select>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-xs"
              onClick={() => setTextInput(prev => prev ? prev + '\n• ' : '• ')}
              title="Insert Bullet Point (•)"
            >
              • List
            </Button>
            <div className="w-px h-6 bg-border mx-1" />
          </>
        )}

        {/* Element editing controls - only show when element is selected */}
        {selectedElement && (() => {
          const selectedEl = elements.find(el => el.id === selectedElement);
          if (!selectedEl) return null;

          return (
            <>
              {/* Color pickers for selected element */}
              <div className="relative">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2 gap-1"
                  onClick={() => { setShowColorPicker(!showColorPicker); setShowFillPicker(false); }}
                  title="Change Stroke Color"
                >
                  <div className="w-4 h-4 rounded border border-gray-400" style={{ backgroundColor: selectedEl.color }} />
                  <span className="text-xs">Stroke</span>
                </Button>
                {showColorPicker && (
                  <div className="absolute top-full left-0 mt-1 p-4 bg-card border rounded-lg shadow-lg z-50 min-w-[240px]">
                    <div className="text-xs font-medium mb-3 text-muted-foreground">Stroke Color</div>
                    <div className="grid grid-cols-5 gap-3">
                      {COLORS.map(c => (
                        <button
                          key={c}
                          className={cn(
                            'w-9 h-9 rounded border-2 transition-transform hover:scale-110',
                            selectedEl.color === c ? 'border-primary ring-2 ring-primary/30' : 'border-gray-300'
                          )}
                          style={{ backgroundColor: c }}
                          onClick={() => {
                            handleChangeStrokeColor(c);
                            setShowColorPicker(false);
                          }}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Fill color picker for shapes */}
              {(selectedEl.type === 'rectangle' || selectedEl.type === 'ellipse') && (
                <div className="relative">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2 gap-1"
                    onClick={() => { setShowFillPicker(!showFillPicker); setShowColorPicker(false); }}
                    title="Change Fill Color"
                  >
                    <div
                      className="w-4 h-4 rounded border border-gray-400"
                      style={{ backgroundColor: selectedEl.fillColor ?? 'transparent' }}
                    >
                      {!selectedEl.fillColor && <div className="w-full h-full flex items-center justify-center text-gray-400 text-xs">∅</div>}
                    </div>
                    <span className="text-xs">Fill</span>
                  </Button>
                  {showFillPicker && (
                    <div className="absolute top-full left-0 mt-1 p-4 bg-card border rounded-lg shadow-lg z-50 min-w-[240px]">
                      <div className="text-xs font-medium mb-3 text-muted-foreground">Fill Color</div>
                      <div className="grid grid-cols-5 gap-3">
                        <button
                          className={cn(
                            'w-9 h-9 rounded border-2 transition-transform hover:scale-110 flex items-center justify-center',
                            !selectedEl.fillColor ? 'border-primary ring-2 ring-primary/30' : 'border-gray-300'
                          )}
                          onClick={() => {
                            handleChangeFillColor(null);
                            setShowFillPicker(false);
                          }}
                          title="No fill"
                        >
                          <span className="text-gray-400 text-xs">∅</span>
                        </button>
                        {COLORS.map(c => (
                          <button
                            key={c}
                            className={cn(
                              'w-9 h-9 rounded border-2 transition-transform hover:scale-110',
                              selectedEl.fillColor === c ? 'border-primary ring-2 ring-primary/30' : 'border-gray-300'
                            )}
                            style={{ backgroundColor: c }}
                            onClick={() => {
                              handleChangeFillColor(c);
                              setShowFillPicker(false);
                            }}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Font size control for selected text */}
              {selectedEl.type === 'text' && (
                <>
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-muted-foreground mr-1">Font:</span>
                    <select
                      value={selectedEl.fontSize || 16}
                      onChange={(e) => handleChangeFontSize(Number(e.target.value))}
                      className="h-8 text-xs border rounded px-2 bg-background"
                    >
                      <option value="12">12px</option>
                      <option value="16">16px</option>
                      <option value="20">20px</option>
                      <option value="24">24px</option>
                      <option value="32">32px</option>
                      <option value="48">48px</option>
                      <option value="64">64px</option>
                    </select>
                  </div>

                  {/* Text formatting buttons */}
                  <Button
                    variant={selectedEl.fontWeight === 'bold' ? 'secondary' : 'ghost'}
                    size="sm"
                    className="h-8 w-8 p-0"
                    onClick={handleToggleBold}
                    title="Bold"
                  >
                    <Bold className="h-4 w-4" />
                  </Button>
                  <Button
                    variant={selectedEl.fontStyle === 'italic' ? 'secondary' : 'ghost'}
                    size="sm"
                    className="h-8 w-8 p-0"
                    onClick={handleToggleItalic}
                    title="Italic"
                  >
                    <Italic className="h-4 w-4" />
                  </Button>
                  <Button
                    variant={selectedEl.textDecoration === 'underline' ? 'secondary' : 'ghost'}
                    size="sm"
                    className="h-8 w-8 p-0"
                    onClick={handleToggleUnderline}
                    title="Underline"
                  >
                    <Underline className="h-4 w-4" />
                  </Button>
                </>
              )}

              <div className="w-px h-6 bg-border mx-1" />

              {/* Layer controls */}
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={handleBringToFront}
                title="Bring to Front"
              >
                <ChevronsUp className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={handleBringForward}
                title="Bring Forward"
              >
                <ArrowUp className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={handleSendBackward}
                title="Send Backward"
              >
                <ArrowDown className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={handleSendToBack}
                title="Send to Back"
              >
                <ChevronsDown className="h-4 w-4" />
              </Button>
              <div className="w-px h-6 bg-border mx-1" />
            </>
          );
        })()}

        {/* Actions */}
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0"
          onClick={handleUndo}
          disabled={undoStack.length === 0}
          title="Undo"
        >
          <Undo2 className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0"
          onClick={handleRedo}
          disabled={redoStack.length === 0}
          title="Redo"
        >
          <Redo2 className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0"
          onClick={handleClear}
          title="Clear"
        >
          <Trash2 className="h-4 w-4" />
        </Button>

        <div className="flex-1" />

        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0"
          onClick={() => fileInputRef.current?.click()}
          title="Upload Image"
        >
          <Upload className="h-4 w-4" />
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleImageUpload(file);
          }}
        />
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0"
          onClick={handleExport}
          title="Export as PNG"
        >
          <Download className="h-4 w-4" />
        </Button>
        {onSave && (
          <>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={_handleSave}
              title="Save Now"
            >
              <Save className="h-4 w-4" />
            </Button>
            <span className="text-xs text-muted-foreground ml-2">
              Autosave enabled
            </span>
          </>
        )}
      </div>

      {/* Canvas */}
      <div
        className="flex-1 overflow-hidden relative bg-white"
        onDrop={handleDrop}
        onDragOver={handleDragOver}
      >
        <canvas
          ref={canvasRef}
          className={cn(
            "absolute inset-0 w-full h-full",
            tool === 'select' ? 'cursor-default' :
            tool === 'text' ? 'cursor-text' :
            'cursor-crosshair'
          )}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onDoubleClick={handleDoubleClick}
        />

        {/* Text input overlay for new text */}
        {textPosition && (
          <div
            className="absolute"
            style={{
              left: `${textPosition.x * zoom + panOffset.x}px`,
              top: `${textPosition.y * zoom + panOffset.y}px`
            }}
          >
            <Textarea
              ref={textInputRef}
              autoFocus
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              onKeyDown={(e) => {
                // Ctrl+Enter or Shift+Enter to submit
                if (e.key === 'Enter' && (e.shiftKey || e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  handleTextSubmit();
                } else if (e.key === 'Escape') {
                  setTextPosition(null);
                  setTextInput('');
                }
                // Plain Enter allows newline (no preventDefault)
              }}
              onBlur={handleTextSubmit}
              className="min-w-[200px] min-h-[80px] resize font-sans"
              placeholder="Type text... (Shift+Enter for new line, Enter to finish)"
              rows={3}
            />
          </div>
        )}

        {/* Text edit overlay for existing text */}
        {editingTextId && (() => {
          const el = elements.find(e => e.id === editingTextId);
          if (!el || el.x === undefined || el.y === undefined) return null;
          return (
            <div
              className="absolute"
              style={{
                left: `${el.x * zoom + panOffset.x}px`,
                top: `${(el.y - 24) * zoom + panOffset.y}px`
              }}
            >
              <Textarea
                autoFocus
                value={editingTextValue}
                onChange={(e) => setEditingTextValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleTextEditSubmit();
                  } else if (e.key === 'Escape') {
                    setEditingTextId(null);
                    setEditingTextValue('');
                  }
                }}
                onBlur={handleTextEditSubmit}
                className="min-w-[200px] min-h-[80px] resize font-sans"
                style={{ color: el.color }}
                rows={3}
              />
            </div>
          );
        })()}
      </div>

      {/* Confirmation Dialog */}
      <ConfirmDialog {...confirmDialogProps} />
    </div>
  );
}

export default Whiteboard;
