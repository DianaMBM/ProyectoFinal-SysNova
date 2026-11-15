@echo off
REM Compila el proyecto y abre la interfaz web de SysNova en el navegador.
cd /d "%~dp0"
if not exist bin mkdir bin
javac -encoding UTF-8 -d bin *.java
if errorlevel 1 (
  echo.
  echo No se pudo compilar. Verifique que tenga instalado el JDK y que javac este en el PATH.
  pause
  exit /b 1
)
echo Abriendo http://localhost:8080 ... (cierre esta ventana para detener el servidor)
java -cp bin ServidorWeb 8080
pause
