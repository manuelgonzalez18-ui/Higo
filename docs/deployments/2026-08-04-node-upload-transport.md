# Transporte documental compatible con hosting Node.js

El endpoint de documentos acepta JSON con archivos codificados en base64 además de multipart/form-data. Esto evita depender de `file_uploads` y `$_FILES` en el runtime PHP auxiliar expuesto detrás del hosting Node.js.
