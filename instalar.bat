@echo off
echo Instalando Higo App... por favor espera...
call npm install
call npm install firebase lucide-react
call npm install -D tailwindcss postcss autoprefixer
call npx tailwindcss init -p
echo.
echo ==========================================
echo ¡Instalacion completada exitosamente!
echo ==========================================
pause