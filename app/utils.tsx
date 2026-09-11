import { SESSION_NUMBER, sessionOrdinal } from "@/config/session";
import { useEffect, useState } from "react";

export { SESSION_NUMBER };

export function getSessionString() {
    return sessionOrdinal(SESSION_NUMBER);
}


function isHardwareAcceleratedWebGL(): boolean {
    if (typeof window === 'undefined') return false;
  
    try {
      const canvas = document.createElement('canvas');
      const gl = (
        canvas.getContext('webgl2') ??
        canvas.getContext('webgl') ??
        canvas.getContext('experimental-webgl')
      ) as WebGLRenderingContext | WebGL2RenderingContext | null;
  
      if (!gl) return false;
  
      const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
      if (debugInfo) {
        const renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) as string;
        if (/swiftshader|llvmpipe|software|microsoft basic render/i.test(renderer)) {
          return false;
        }
      }
  
      return true;
    } catch {
      return false;
    }
  }
  
  export function useWebGL(): boolean {
    const [supported, setSupported] = useState(false);
  
    useEffect(() => {
      setSupported(isHardwareAcceleratedWebGL());
    }, []);
  
    return supported;
  }
  