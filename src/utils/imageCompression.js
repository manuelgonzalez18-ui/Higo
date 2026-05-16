// Comprime una imagen del cliente con canvas → JPEG para no exceder
// upload_max_filesize de Hostinger ni el ancho de banda móvil. Una foto
// típica de 6 MB queda en ~200-400 KB. Si el `file` no es una imagen,
// devuelve el original sin tocar.
//
// Patrón extraído de AdminDriversPage.jsx para reusarlo en el chat de
// soporte (adjuntos). Mantengo la API simple: Promise<File>.
export const compressImage = (file, maxSize = 1600, quality = 0.85) =>
    new Promise((resolve, reject) => {
        if (!file || !file.type?.startsWith('image/')) { resolve(file); return; }
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            URL.revokeObjectURL(url);
            const ratio = Math.min(maxSize / img.width, maxSize / img.height, 1);
            const w = Math.max(1, Math.round(img.width * ratio));
            const h = Math.max(1, Math.round(img.height * ratio));
            const canvas = document.createElement('canvas');
            canvas.width = w; canvas.height = h;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, w, h);
            canvas.toBlob((blob) => {
                if (!blob) { reject(new Error('compression_failed')); return; }
                const baseName = (file.name || 'image').replace(/\.[^.]+$/, '');
                resolve(new File([blob], baseName + '.jpg', { type: 'image/jpeg' }));
            }, 'image/jpeg', quality);
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image_load_failed')); };
        img.src = url;
    });
