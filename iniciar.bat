@echo off
cd /d "%~dp0"
echo ==========================================
echo       ENCENDIENDO HIGO APP...
echo ==========================================
echo.
echo No cierres esta ventana negra mientras uses la app.
echo.
call npm run dev
pause