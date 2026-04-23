// Inline SVG markers (data URIs). Reemplazan los PNG pesados (~700KB total → ~3KB).
// Los iconos "top view" apuntan al ESTE (90°) por convención; el componente
// VehicleIconWithHeading aplica offset -90° para alinear con el heading GPS.

const svg = (inner) =>
    `data:image/svg+xml;utf8,${encodeURIComponent(
        `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'>${inner}</svg>`
    )}`;

// Moto top-view (apuntando al ESTE). Cuerpo rojo, ruedas negras, detalle blanco.
export const MotoIcon = svg(`
    <defs><filter id='s' x='-20%' y='-20%' width='140%' height='140%'><feDropShadow dx='0' dy='1' stdDeviation='1.2' flood-opacity='.35'/></filter></defs>
    <g filter='url(#s)'>
        <rect x='10' y='27' width='6' height='10' rx='1' fill='#111'/>
        <rect x='48' y='27' width='6' height='10' rx='1' fill='#111'/>
        <path d='M16 32 L48 32 L52 28 L52 36 L48 32 Z' fill='#E11D48'/>
        <rect x='22' y='24' width='20' height='16' rx='4' fill='#DC2626'/>
        <rect x='28' y='22' width='8' height='4' rx='1' fill='#1F2937'/>
        <circle cx='32' cy='32' r='3' fill='#FEE2E2'/>
    </g>
`);

// Carro top-view (rojo, apuntando al ESTE).
export const StandardIcon = svg(`
    <defs><filter id='s' x='-20%' y='-20%' width='140%' height='140%'><feDropShadow dx='0' dy='1' stdDeviation='1.4' flood-opacity='.35'/></filter></defs>
    <g filter='url(#s)'>
        <rect x='10' y='18' width='44' height='28' rx='6' fill='#DC2626'/>
        <rect x='14' y='22' width='14' height='20' rx='3' fill='#1E293B' opacity='.7'/>
        <rect x='36' y='22' width='14' height='20' rx='3' fill='#1E293B' opacity='.7'/>
        <rect x='52' y='28' width='4' height='8' rx='1' fill='#FCD34D'/>
        <rect x='8' y='28' width='4' height='8' rx='1' fill='#7F1D1D'/>
    </g>
`);

// Van/Camioneta top-view (roja, más alargada).
export const VanIcon = svg(`
    <defs><filter id='s' x='-20%' y='-20%' width='140%' height='140%'><feDropShadow dx='0' dy='1' stdDeviation='1.4' flood-opacity='.35'/></filter></defs>
    <g filter='url(#s)'>
        <rect x='6' y='16' width='52' height='32' rx='6' fill='#DC2626'/>
        <rect x='10' y='20' width='14' height='24' rx='2' fill='#1E293B' opacity='.7'/>
        <rect x='28' y='20' width='12' height='24' rx='2' fill='#1E293B' opacity='.7'/>
        <rect x='44' y='20' width='10' height='24' rx='2' fill='#1E293B' opacity='.7'/>
        <rect x='56' y='28' width='4' height='8' rx='1' fill='#FCD34D'/>
        <rect x='4' y='28' width='4' height='8' rx='1' fill='#7F1D1D'/>
    </g>
`);

// Pin de pickup/pasajero (rojo con círculo interior).
export const PassengerPin = svg(`
    <defs><filter id='s' x='-20%' y='-20%' width='140%' height='140%'><feDropShadow dx='0' dy='2' stdDeviation='1.5' flood-opacity='.4'/></filter></defs>
    <g filter='url(#s)'>
        <path d='M32 6 C21 6 13 14 13 25 C13 40 32 58 32 58 C32 58 51 40 51 25 C51 14 43 6 32 6 Z' fill='#DC2626'/>
        <circle cx='32' cy='24' r='8' fill='#FEF2F2'/>
        <circle cx='32' cy='22' r='3' fill='#DC2626'/>
        <path d='M26 30 Q32 26 38 30 Q38 33 32 33 Q26 33 26 30 Z' fill='#DC2626'/>
    </g>
`);

// Pin de destino (rojo con bandera a cuadros).
export const DestinationPin = svg(`
    <defs>
        <filter id='s' x='-20%' y='-20%' width='140%' height='140%'><feDropShadow dx='0' dy='2' stdDeviation='1.5' flood-opacity='.4'/></filter>
        <pattern id='c' x='0' y='0' width='4' height='4' patternUnits='userSpaceOnUse'>
            <rect width='2' height='2' fill='#111'/>
            <rect x='2' y='2' width='2' height='2' fill='#111'/>
            <rect x='2' width='2' height='2' fill='#fff'/>
            <rect y='2' width='2' height='2' fill='#fff'/>
        </pattern>
    </defs>
    <g filter='url(#s)'>
        <path d='M32 6 C21 6 13 14 13 25 C13 40 32 58 32 58 C32 58 51 40 51 25 C51 14 43 6 32 6 Z' fill='#DC2626'/>
        <rect x='23' y='16' width='18' height='14' fill='url(#c)' rx='1'/>
    </g>
`);

// Carro "cartoon" frontal — usado sólo en ServiceSelection (icono de selección).
export const StandardCartoonIcon = svg(`
    <g>
        <rect x='8' y='30' width='48' height='20' rx='6' fill='#FCD34D'/>
        <path d='M14 30 L20 18 L44 18 L50 30 Z' fill='#FBBF24'/>
        <rect x='22' y='22' width='20' height='8' rx='2' fill='#BAE6FD'/>
        <circle cx='18' cy='50' r='6' fill='#111827'/>
        <circle cx='46' cy='50' r='6' fill='#111827'/>
        <circle cx='18' cy='50' r='2.5' fill='#6B7280'/>
        <circle cx='46' cy='50' r='2.5' fill='#6B7280'/>
        <rect x='50' y='34' width='4' height='4' rx='1' fill='#FEF08A'/>
        <rect x='10' y='34' width='4' height='4' rx='1' fill='#FEE2E2'/>
    </g>
`);
