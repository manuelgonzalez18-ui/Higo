// Markers PNG servidos desde public_html/markers/ en Hostinger (subidos manualmente
// al FTP, fuera de /dist, por eso deploy.yml los excluye del --delete).

export const MotoIcon = '/markers/moto.png';
export const StandardIcon = '/markers/car.png';
export const VanIcon = '/markers/van.png';
export const PassengerPin = '/markers/pin_pickup.png';
export const DestinationPin = '/markers/pin_dropoff.png';

const svg = (inner) =>
    `data:image/svg+xml;utf8,${encodeURIComponent(
        `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'>${inner}</svg>`
    )}`;

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
