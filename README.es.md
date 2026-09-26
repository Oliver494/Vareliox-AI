# Vareliox

Español · [English](README.md)

Vareliox es un espacio de trabajo de IA open source, centrado en IA local y diseñado para Windows, macOS y Linux. Permite conversar, crear contenido y trabajar como agente sobre carpetas reales con proveedores locales o externos, sin crear una cuenta de Vareliox.

> Beta temprana: utiliza Git o una copia de seguridad para proyectos importantes. Las funciones de agente pueden modificar archivos y ejecutar un conjunto restringido de comandos del proyecto.

## ¿Por qué Vareliox?

- IA local primero: Ollama y LM Studio son proveedores de primera clase.
- Errores comprensibles: pruebas de conexión, timeouts, cancelación y diagnósticos accionables.
- Chat por proyecto: las conversaciones se almacenan y mantienen aisladas por carpeta.
- Cambios revisables: las operaciones se limitan al proyecto seleccionado.
- Sin cuenta de Vareliox: las credenciales permanecen bajo el control del usuario.

## Funciones actuales

- Abrir y recordar varios proyectos.
- Explorador que respeta `.gitignore` y excluye builds y cachés habituales.
- Editor con pestañas, resaltado y guardado atómico.
- Crear, renombrar, editar y eliminar archivos o carpetas.
- Historial por proyecto, chats fijados, archivado, duplicado y búsqueda.
- Adjuntar archivos e imágenes y pegar imágenes con Ctrl+V.
- Streaming, cancelación, timeouts y diagnósticos de conexión.
- Ollama, LM Studio, OpenAI, Anthropic, Google Gemini, NVIDIA API, Z.AI y endpoints personalizados compatibles con OpenAI.
- API keys guardadas mediante el almacén seguro del sistema operativo.
- Selección de modelos y control de esfuerzo cuando el modelo lo permite.
- Operaciones de archivos con revisión y modos de permiso.
- Terminal configurable: desactivada, herramientas seguras, shell normal o administrador; CMD/PowerShell en Windows y Bash/Zsh en macOS y Linux.
- La salida real de los comandos vuelve al modelo para que pueda responder con datos comprobados del equipo.
- Acceso al sistema de archivos limitado al proyecto de fábrica, con acceso completo opcional y revisión obligatoria fuera del proyecto.
- Catálogo de modelos locales para Ollama y LM Studio.
- Temas claro/oscuro y 12 idiomas.
- Avisos de actualizaciones desde GitHub Releases.

## Seguridad

De fábrica Vareliox bloquea rutas absolutas, `..`, enlaces simbólicos, carpetas ignoradas, nombres inseguros, shells y comandos de sistema sin restricciones. El acceso completo a archivos, la terminal normal y el modo administrador son permisos opcionales separados. Los comandos administrativos siempre requieren aprobación y Vareliox nunca conoce la contraseña del usuario.

Lee [SECURITY.md](SECURITY.md) antes de activar permisos de agente y [PRIVACY.md](PRIVACY.md) para saber cuándo el código puede salir del equipo.

## Instalación

Descarga desde Releases el instalador `.exe` para Windows, el `.dmg` universal para Mac con Apple Silicon o Intel, el paquete `.deb` para Kali/Debian/Ubuntu o la AppImage para otras distribuciones Linux x86_64. En macOS, abre el `.dmg` y arrastra Vareliox a Aplicaciones. La compilación de macOS usa firma ad hoc, por lo que puede requerir autorización en Privacidad y seguridad hasta disponer de certificado y notarización de Apple. En Kali, instala el paquete con `sudo apt install ./Vareliox*.deb`.

Los usuarios finales no necesitan instalar Node.js ni Rust.

## Desarrollo

Requisitos: Node.js 22+, Rust estable y las dependencias de Tauri 2 para el sistema operativo.

```bash
npm install
npm run tauri dev
```

```bash
npm run test:all
npm run tauri build -- --bundles nsis
```

En Kali/Debian/Ubuntu:

```bash
sudo apt update
sudo apt install -y build-essential curl wget file libwebkit2gtk-4.1-dev \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev patchelf xdg-utils
npm ci
npm run build:linux
```

En macOS con Xcode Command Line Tools:

```bash
rustup target add aarch64-apple-darwin x86_64-apple-darwin
npm ci
npm run test:all
npm run build:macos
```

El `.dmg` universal se genera en `src-tauri/target/universal-apple-darwin/release/bundle/dmg/`. También puede compilarse mediante el flujo manual **Build macOS installer** de GitHub Actions.

Consulta [ROADMAP.md](ROADMAP.md), [CONTRIBUTING.md](CONTRIBUTING.md) y [CHANGELOG.md](CHANGELOG.md).

## Independencia y marcas

Vareliox es un proyecto independiente y no está afiliado, respaldado ni patrocinado por OpenAI, Anthropic, Google, NVIDIA, Ollama, LM Studio, Z.AI ni otros proveedores compatibles. Las marcas y logotipos pertenecen a sus propietarios. Consulta [TRADEMARKS.md](TRADEMARKS.md).

## Licencia

Publicado bajo la [licencia Apache 2.0](LICENSE).
