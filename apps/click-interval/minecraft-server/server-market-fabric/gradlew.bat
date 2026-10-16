@echo off
setlocal
if defined JAVA_HOME (set "MARKET_JAVA=%JAVA_HOME%\bin\java.exe") else (set "MARKET_JAVA=java.exe")
"%MARKET_JAVA%" -classpath "%~dp0gradle\wrapper\gradle-wrapper.jar" org.gradle.wrapper.GradleWrapperMain %*
exit /b %ERRORLEVEL%
