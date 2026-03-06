# Contributing to PDFling

Gracias por aportar a PDFling.

## Requisitos

- Node.js 18+
- npm 9+
- Chrome con soporte de extensiones MV3

## Flujo de trabajo recomendado

1. Haz fork del repositorio.
2. Crea una rama descriptiva:
   - `feature/nombre-corto`
   - `fix/nombre-corto`
   - `docs/nombre-corto`
3. Instala dependencias y compila:
   - `npm install`
   - `npm run build`
4. Realiza cambios pequenos y enfocados.
5. Verifica que la extension siga cargando correctamente desde `dist/`.
6. Abre un Pull Request con contexto funcional.

## Estandar de cambios

- Mantener consistencia con TypeScript modular.
- Priorizar claridad de nombres y separacion por dominios.
- Evitar mezclar cambios de UI, logica y build sin necesidad.
- Mantener compatibilidad con Manifest V3.

## Commits

Usa mensajes claros, por ejemplo:

- `feat: add shape popover controls`
- `fix: persist workspace theme in popup`
- `docs: improve setup section`

## Pull Requests

Incluye en el PR:

- problema que resuelve
- enfoque aplicado
- capturas o video corto si hubo cambios de UI
- riesgos conocidos
- checklist de validacion

## Reporte de bugs

Usa la plantilla de issue y agrega:

- pasos para reproducir
- resultado esperado
- resultado actual
- navegador y version

## Seguridad

No publiques vulnerabilidades en issues publicos. Revisa `SECURITY.md`.
