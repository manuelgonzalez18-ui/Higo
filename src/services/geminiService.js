import { GoogleGenAI } from "@google/genai";

// Initialize Gemini Client
const API_KEY = import.meta.env.VITE_GEMINI_API_KEY;
if (!API_KEY) console.warn("Missing VITE_GEMINI_API_KEY in .env");
const ai = new GoogleGenAI({ apiKey: API_KEY });

// Mock Data for Fallback
const MOCK_LOCATIONS = [
    { title: "Panaderia Bisau", address: "Higuerote, Miranda", lat: 10.48424, lng: -66.09871 },
    { title: "Alamar", address: "Higuerote, Miranda", lat: 10.412485185404462, lng: -66.1378176707 },
    { title: "Asocanales", address: "Higuerote, Miranda", lat: 10.498549543479797, lng: -66.1134562060818 },
    { title: "Residencia Marina Caribe", address: "Higuerote, Miranda", lat: 10.467131341169896, lng: -66.11266963515165 },
    { title: "Barrio Ajuro", address: "Higuerote, Miranda", lat: 10.483529085105532, lng: -66.10358083847191 },
    { title: "Belen", address: "Higuerote, Miranda", lat: 10.382768313794767, lng: -66.11422048727452 },
    { title: "Birongo", address: "Higuerote, Miranda", lat: 10.482504309904929, lng: -66.23813050633483 },
    { title: "Bosque de Curiepe", address: "Higuerote, Miranda", lat: 10.46071080081163, lng: -66.17747378136937 },
    { title: "Brisas del Cocal", address: "Higuerote, Miranda", lat: 10.485371658181556, lng: -66.10726964277275 },
    { title: "Buche Urbanizacion", address: "Higuerote, Miranda", lat: 10.547088443855559, lng: -66.09523336382708 },
    { title: "Cabo Codera", address: "Higuerote, Miranda", lat: 10.475673126024594, lng: -66.09953026275525 },
    { title: "C.C Cabo Mall", address: "Higuerote, Miranda", lat: 10.470893934731668, lng: -66.10183696237596 },
    { title: "Calle Larga", address: "Higuerote, Miranda", lat: 10.477202873689913, lng: -66.10422949262944 },
    { title: "Camaronera", address: "Higuerote, Miranda", lat: 10.54827675686517, lng: -66.1378337782917 },
    { title: "Caño Madrid", address: "Higuerote, Miranda", lat: 10.43731332967169, lng: -66.05738433869561 },
    { title: "Capaya", address: "Higuerote, Miranda", lat: 10.428762559434038, lng: -66.27345603583123 },
    { title: "Carenero", address: "Higuerote, Miranda", lat: 10.530882839293874, lng: -66.11379162734633 },
    { title: "Casitas Azules", address: "Higuerote, Miranda", lat: 10.475657842358942, lng: -66.1105550329455 },
    { title: "C.I.C.P.C Higuerote", address: "Higuerote, Miranda", lat: 10.465925499578404, lng: -66.10503556941445 },
    { title: "Aguasal", address: "Higuerote, Miranda", lat: 10.468432536882966, lng: -66.09005766779443 },
    { title: "Chirimena", address: "Higuerote, Miranda", lat: 10.605334622192906, lng: -66.17343061545287 },
    { title: "C.I.C.P.C Higuerote", address: "Higuerote, Miranda", lat: 10.465925499578404, lng: -66.10503556941445 },
    { title: "Ciudad Balneario", address: "Higuerote, Miranda", lat: 10.492664186819404, lng: -66.1080637833722 },
    { title: "Ciudad Brion", address: "Higuerote, Miranda", lat: 10.417833320209372, lng: -66.098501708181 },
    { title: "Ciudad Brion Segunda Etapa", address: "Higuerote, Miranda", lat: 10.42556782090137, lng: -66.09201076245094 },
    { title: "Colinas de Tacarigua", address: "Higuerote, Miranda", lat: 10.404504851406475, lng: -66.1434394321293 },
    { title: "Corrales", address: "Higuerote, Miranda", lat: 10.607333000853268, lng: -66.1636834682879 },
    { title: "El Cien (100)", address: "Higuerote, Miranda", lat: 10.39483868070011, lng: -66.13243164608072 },
    { title: "La Ceiba", address: "Higuerote, Miranda", lat: 10.475657842358942, lng: -66.1105550329455 },
    { title: "Residencias Hipo Campo", address: "Higuerote, Miranda", lat: 10.477586530990964, lng: -66.10336571853655 },
    { title: "Residencias Quita Sol", address: "Higuerote, Miranda", lat: 10.476895508840414, lng: -66.10439568671667 },
    { title: "Tacarigua", address: "Higuerote, Miranda", lat: 10.465925499578404, lng: -66.10503556941445 },
    { title: "Universidad Argelia Alaya Higuerote", address: "Higuerote, Miranda", lat: 10.477354432124184, lng: -66.10308676881971 },
    { title: "Urb Costa Grande", address: "Higuerote, Miranda", lat: 10.454771436076511, lng: -66.1104038351519 },
    { title: "Urb Emilio Gonzalez Marin", address: "Higuerote, Miranda", lat: 10.475657842358942, lng: -66.1105550329455 },
    { title: "Urb la Arboleda (El 50)", address: "Higuerote, Miranda", lat: 10.405655063578763, lng: -66.1461645559027 },
    { title: "Urb Campomar", address: "Higuerote, Miranda", lat: 10.423195351936672, lng: -66.12350615494626 },
    { title: "Dos Caminos Parte Baja", address: "Higuerote, Miranda", lat: 10.435378234258888, lng: -66.11125078621103 },
    { title: "Dos Caminos Subida del Camello", address: "Higuerote, Miranda", lat: 10.432819514299345, lng: -66.11090209914373 },
    { title: "Dos Caminos Transito", address: "Higuerote, Miranda", lat: 10.432819514299345, lng: -66.11090209914373 },
    { title: "Muelle de Cuchivano", address: "Higuerote, Miranda", lat: 10.490002391534263, lng: -66.0956105063566 },
    { title: "Curiepe", address: "Higuerote, Miranda", lat: 10.474252096311538, lng: -66.16559159635693 },
    { title: "El INCRET", address: "Higuerote, Miranda", lat: 10.466602271653805, lng: -66.08824690317904 },
    { title: "Conjunto Residencial El Paraiso Sol", address: "Higuerote, Miranda", lat: 10.422219185606785, lng: -66.10169549853701 },
    { title: "El Dividivi", address: "Higuerote, Miranda", lat: 10.468574387663173, lng: -66.11539200816321 },
    { title: "Estanciamar", address: "Higuerote, Miranda", lat: 10.41712381311262, lng: -66.0967668578242 },
    { title: "Gamelotal", address: "Higuerote, Miranda", lat: 10.403481082608838, lng: -66.20307385430911 },
    { title: "Guayacan", address: "Higuerote, Miranda", lat: 10.535070475486249, lng: -66.1220527703596 },
    { title: "Hospital Universitario General de Higuerote", address: "Higuerote, Miranda", lat: 10.474885053128025, lng: -66.10787550619183 },
    { title: "Hotel Agua Marina", address: "Higuerote, Miranda", lat: 10.468432536882966, lng: -66.09005766779443 },
    { title: "Hotel Puente Machado", address: "Higuerote, Miranda", lat: 10.401550909168895, lng: -66.16754903270287 },
    { title: "INASS -INAGER", address: "Higuerote, Miranda", lat: 10.46568159205526, lng: -66.11407243242002 },
    { title: "Isla de la Fantasia", address: "Higuerote, Miranda", lat: 10.481643860534366, lng: -66.11130975678007 },
    { title: "Las Delicias", address: "Higuerote, Miranda", lat: 10.48218190020157, lng: -66.10479735316714 },
    { title: "Las Maravillas", address: "Higuerote, Miranda", lat: 10.363500505947375, lng: -66.16892897102714 },
    { title: "Las Gonzalez", address: "Higuerote, Miranda", lat: 10.403700908099774, lng: -66.18373459769425 },
    { title: "Las Martinez", address: "Higuerote, Miranda", lat: 10.404064967458327, lng: -66.19121796076742 },
    { title: "Las Morochas", address: "Higuerote, Miranda", lat: 10.413521459649557, lng: -66.2457596135795 },
    { title: "Las Toros", address: "Higuerote, Miranda", lat: 10.36275543438238, lng: -66.22527766296433 },
    { title: "Las Velitas (3 de Junio)", address: "Higuerote, Miranda", lat: 10.475826642453695, lng: -66.10848704992625 },
    { title: "Lagoven - Oso Cotiza", address: "Higuerote, Miranda", lat: 10.535070475486249, lng: -66.1220527703596 },
    { title: "La Maturetera", address: "Higuerote, Miranda", lat: 10.409734197276734, lng: -66.23444415180826 },
    { title: "La Costanera", address: "Higuerote, Miranda", lat: 10.468432536882966, lng: -66.09005766779443 },
    { title: "Playa Los Totumos", address: "Higuerote, Miranda", lat: 10.547300673976322, lng: -66.0799098 },
    { title: "Mamporal - Plaza - Maurica", address: "Higuerote, Miranda", lat: 10.367100121777433, lng: -66.13455286537514 },
    { title: "Playa Puerto Frances", address: "Higuerote, Miranda", lat: 10.574257839917157, lng: -66.06795518433181 },
    { title: "Maturin Centro", address: "Higuerote, Miranda", lat: 10.403236523746722, lng: -66.16231240598361 },
    { title: "Mesa Grande Parte Baja", address: "Higuerote, Miranda", lat: 10.463265552512356, lng: -66.11863218742052 },
    { title: "Mesa Grande Parte Alta", address: "Higuerote, Miranda", lat: 10.45604897311753, lng: -66.1241253512522 },
    { title: "Moron", address: "Higuerote, Miranda", lat: 10.464640844200634, lng: -66.1759020082631 },
    { title: "Nuevo Carenero", address: "Higuerote, Miranda", lat: 10.534599457633282, lng: -66.12990488912718 },
    { title: "Planta PDVSA", address: "Higuerote, Miranda", lat: 10.555861950091172, lng: -66.07230327861782 },
    { title: "Prado Largo - Entrada", address: "Higuerote, Miranda", lat: 10.401437398939402, lng: -66.18970519472253 },
    { title: "Urbanizacion Nautica Puerto Encantado", address: "Higuerote, Miranda", lat: 10.488119741712058, lng: -66.11200177745367 },
    { title: "Conjunto Residencial Parque Adonay", address: "Higuerote, Miranda", lat: 10.402853392519908, lng: -66.15247847642007 },
    { title: "Pueblo Seco", address: "Higuerote, Miranda", lat: 10.577480953179709, lng: -66.21296878854798 },
    { title: "Rancho Grande", address: "Higuerote, Miranda", lat: 10.468432536882966, lng: -66.09005766779443 },
    { title: "Radio Costera", address: "Higuerote, Miranda", lat: 10.490497591733575, lng: -66.10994618099599 },
    { title: "Salgado", address: "Higuerote, Miranda", lat: 10.474411290050185, lng: -66.21098265418635 },
    { title: "San Luis", address: "Higuerote, Miranda", lat: 10.479833118700869, lng: -66.10247219886672 },
    { title: "San Vicente", address: "Higuerote, Miranda", lat: 10.3733267355515, lng: -66.15960469619428 },
    { title: "San Juan la Troja", address: "Higuerote, Miranda", lat: 10.31617086484119, lng: -66.07095104121329 },
    { title: "San Francisquito", address: "Higuerote, Miranda", lat: 10.560028799276422, lng: -66.05638657172642 },
    { title: "Sotillo", address: "Higuerote, Miranda", lat: 10.400214403419566, lng: -66.08456610041378 },
    { title: "Playa Valle Seco", address: "Higuerote, Miranda", lat: 10.51475914621681, lng: -66.11535773511726 },
    { title: "Tacarigua - Estadio", address: "Higuerote, Miranda", lat: 10.394126369102322, lng: -66.14693703269718 },
    { title: "Tacarigüita", address: "Higuerote, Miranda", lat: 10.441764089160975, lng: -66.21214136498637 },
    { title: "Terra El Mango - El Jobo", address: "Higuerote, Miranda", lat: 10.446797036502634, lng: -66.11770061298945 },
    { title: "Yaguapa", address: "Higuerote, Miranda", lat: 10.388269504276094, lng: -66.29057146950038 },
    { title: "El Zancudo", address: "Higuerote, Miranda", lat: 10.468432536882966, lng: -66.09005766779443 },
    { title: "Zona del Este", address: "Higuerote, Miranda", lat: 10.476571932177347, lng: -66.09563391238734 },
    { title: "Aricagua", address: "Higuerote, Miranda", lat: 10.580681683061407, lng: -66.23353610167855 },
    { title: "Caucagua Centro", address: "Higuerote, Miranda", lat: 10.28824727184857, lng: -66.37523958609698 },
    { title: "Caucagua - Los Cocos", address: "Higuerote, Miranda", lat: 10.279548732262098, lng: -66.3523013346876 },
    { title: "Caucagua - Marizapa", address: "Higuerote, Miranda", lat: 10.279866987267152, lng: -66.3623143844232 },
    { title: "Chirere", address: "Higuerote, Miranda", lat: 10.617765815448083, lng: -66.19015934489563 },
    { title: "Chuspa", address: "Higuerote, Miranda", lat: 10.61642674922747, lng: -66.31297765334563 },
    { title: "Paparo", address: "Higuerote, Miranda", lat: 10.379405636698834, lng: -65.98862222551986 },
    { title: "Guayabal", address: "Higuerote, Miranda", lat: 10.586519219087986, lng: -66.30819794578676 },
    { title: "Rio Chico Centro", address: "Higuerote, Miranda", lat: 10.31823557751452, lng: -65.97892152006963 },
    { title: "San Jose Centro", address: "Higuerote, Miranda", lat: 10.302825615602371, lng: -65.99468008929469 },
    { title: "Tacarigua de la Laguna", address: "Higuerote, Miranda", lat: 10.305185073476565, lng: -65.8769417859132 },
    { title: "El Clavo", address: "Higuerote, Miranda", lat: 10.22492025611194, lng: -66.17422574680374 },
    { title: "Centro Comercial Flamingo", address: "Higuerote, Miranda", lat: 10.467939872322962, lng: -66.10413829765304 },
    { title: "Club Puerto Azul", address: "Naiguatá (Demo)", lat: 10.6012, lng: -66.7321 },
    { title: "Puerto Encantado", address: "Higuerote", lat: 10.4732, lng: -66.1245 },
    { title: "La Pergola Marina", address: "Higuerote, Miranda", lat: 10.487432064352946, lng: -66.10935070383101 },
    { title: "Concha Acustica de Higuerote", address: "Higuerote, Miranda", lat: 10.487612924469255, lng: -66.0981005082914 },
    { title: "El Rancho del Pescador RDP", address: "Higuerote, Miranda", lat: 10.483538043147192, lng: -66.0975425026995 },
    { title: "Alcaldia del Municipio Brion", address: "Higuerote, Miranda", lat: 10.487201239710554, lng: -66.09932092900381 },
    { title: "Higuerote Centro", address: "Higuerote, Miranda", lat: 10.48483773064799, lng: -66.09798352908754 },
    { title: "Estadio Pedro Roberto Ruiz", address: "Higuerote, Miranda", lat: 10.474155023808159, lng: -66.1016490742378 },
    { title: "Monumento Virgen del Carmen de Higuerote", address: "Higuerote, Miranda", lat: 10.474384487558758, lng: -66.10087659805842 },
    { title: "Fuente de Higuerote", address: "Higuerote, Miranda", lat: 10.489446960592378, lng: -66.10492405136587 },
    { title: "Centro de Diagnostico Integral de Higuerote (CDI)", address: "Higuerote, Miranda", lat: 10.483108740768065, lng: -66.0977556302763 },
    { title: "Edif Marbella", address: "Higuerote, Miranda", lat: 10.483235337819526, lng: -66.09732647686575 },
    { title: "Terminal de Pasajeros de Higuerote", address: "Higuerote, Miranda", lat: 10.484722849307069, lng: -66.0977770879345 },
    { title: "Ferreteria de Higuerote", address: "Higuerote, Miranda", lat: 10.483783924450451, lng: -66.10069264901169 },
    { title: "Colegio Nuestra Senora del Carmen", address: "Higuerote, Miranda", lat: 10.483652052754344, lng: -66.10032786861272 },
    { title: "Unidad Educativa Privada Barlovento", address: "Higuerote, Miranda", lat: 10.486202441430907, lng: -66.10815991885217 },
    { title: "Colegio Simon Rodriguez", address: "Higuerote, Miranda", lat: 10.485638394687205, lng: -66.09768909804292 },
    { title: "Liceo Rafael Arevalo Gonzalez", address: "Higuerote, Miranda", lat: 10.479192478956836, lng: -66.10092652424068 },
    { title: "Panaderia Central de Higuerote", address: "Higuerote, Miranda", lat: 10.485150472046671, lng: -66.09806997179011 },
    { title: "C.C Majopa", address: "Higuerote, Miranda", lat: 10.485472237335097, lng: -66.0991267620603 },
    { title: "Las 4 Esquinas", address: "Higuerote, Miranda", lat: 10.485290255372115, lng: -66.09897119394898 },
    { title: "Banco Mercantil de Higuerote", address: "Higuerote, Miranda", lat: 10.485870487353749, lng: -66.09852594727558 },
    { title: "Banco Banesco de Higuerote", address: "Higuerote, Miranda", lat: 10.486719734021246, lng: -66.0992286860047 },
    { title: "Banco de Venezuela de Higuerote", address: "Higuerote, Miranda", lat: 10.484111326136436, lng: -66.09927428352032 },
    { title: "Funchal", address: "Higuerote, Miranda", lat: 10.483322733373686, lng: -66.10012454376246 },
    { title: "La Nueva Andinita", address: "Higuerote, Miranda", lat: 10.483074814162231, lng: -66.09916163078621 },
    { title: "Centro Quirurgirco (Clinica) de Higuerote", address: "Higuerote, Miranda", lat: 10.48294030472091, lng: -66.09932524551778 },
    { title: "Hotel AB Beach", address: "Higuerote, Miranda", lat: 10.473655349316322, lng: -66.10102028210979 },
    { title: "Farmatodo de Higuerote", address: "Higuerote, Miranda", lat: 10.473296646429766, lng: -66.1004811581354 },
    { title: "Licoreria y Bodegon Gustamar", address: "Higuerote, Miranda", lat: 10.47573898282487, lng: -66.10011369547595 },
    { title: "Frigorifico y Bodegon Costa Brava", address: "Higuerote, Miranda", lat: 10.477189605481025, lng: -66.0995101984394 },
    { title: "Prolicor de Higuerote", address: "Higuerote, Miranda", lat: 10.483719960812817, lng: -66.09957591252382 },
    { title: "Delivery Express", address: "Higuerote, Miranda", lat: 10.486607937526726, lng: -66.1090132649471 },
    { title: "Bodegota Market", address: "Higuerote, Miranda", lat: 10.488705989555232, lng: -66.11272141890747 },
    { title: "San Antonio de los Altos", address: "Miranda", lat: 10.374698747674902, lng: -66.95996625032774 },
    { title: "Aeropuerto Simon Bolivar Maiquetia", address: "Vargas", lat: 10.59833844373073, lng: -66.98254946952477 },
    { title: "Catia La Mar", address: "Vargas", lat: 10.60048997395859, lng: -67.03981205700744 },
    { title: "Charallave", address: "Miranda", lat: 10.210045238950558, lng: -66.86656661615467 },
    { title: "Nueva Cua", address: "Miranda", lat: 10.131347167945107, lng: -66.86902278530357 },
    { title: "Ocumare del Tuy", address: "Miranda", lat: 10.116737490027084, lng: -66.77527887974398 },
    { title: "Santa Teresa", address: "Miranda", lat: 10.270973009146386, lng: -66.70676383614479 },
    { title: "Altagracia de Orituco", address: "Guárico", lat: 9.857484706153148, lng: -66.37215409442607 },
    { title: "Anaco", address: "Anzoátegui", lat: 9.428558998675962, lng: -64.46494729389852 },
    { title: "Guatire", address: "Miranda", lat: 10.458203422513298, lng: -66.53832633041114 },
    { title: "Guarenas", address: "Miranda", lat: 10.470885958517732, lng: -66.61567173097214 },
    { title: "Petare", address: "Miranda", lat: 10.477524959145718, lng: -66.80606847956666 },
    { title: "Caracas Centro", address: "Distrito Capital", lat: 10.499866418357938, lng: -66.91038682553959 },
    { title: "Terminal La Bandera", address: "Distrito Capital", lat: 10.476393714692897, lng: -66.89888902840435 },
    { title: "Caricuao", address: "Distrito Capital", lat: 10.434362393591321, lng: -66.97739888660641 },
    { title: "Catia", address: "Distrito Capital", lat: 10.51661076625772, lng: -66.94571593824786 },
    { title: "La Yaguara", address: "Distrito Capital", lat: 10.483177684793526, lng: -66.95248349082316 },
    { title: "Los Teques", address: "Miranda", lat: 10.348965964889615, lng: -67.03411267590872 },
    // Batch 10
    { title: "Cumana", address: "Sucre", lat: 10.431117316856744, lng: -64.18217813721513 },
    { title: "Cupira", address: "Miranda", lat: 10.161173403919324, lng: -65.69816723474297 },
    { title: "El Guapo", address: "Miranda", lat: 10.146663007884356, lng: -65.97172030531057 },
    { title: "Guapeton", address: "Miranda", lat: 10.152077613960039, lng: -65.89916680234563 },
    { title: "El Tigre Oriente", address: "Anzoátegui", lat: 8.883980175467736, lng: -64.23749092992242 },
    { title: "Güiria", address: "Sucre", lat: 10.574558527042987, lng: -62.29977646816163 },
    { title: "Maturin Monagas", address: "Monagas", lat: 9.745351971277808, lng: -63.177347550677226 },
    { title: "Puerto La Cruz", address: "Anzoátegui", lat: 10.204323443963357, lng: -64.63460986872707 },
    { title: "Barquisimeto", address: "Lara", lat: 10.06905190243356, lng: -69.34530186885053 },
    { title: "Chichiriviche", address: "Falcón", lat: 10.930825135717576, lng: -68.2771418736968 },
    { title: "Coro", address: "Falcón", lat: 11.39585166427313, lng: -69.67943585449473 },
    { title: "La Victoria", address: "Aragua", lat: 10.219110573897945, lng: -67.33264244522525 },
    { title: "Magdaleno", address: "Aragua", lat: 10.098339419178766, lng: -67.61462703301649 },
    { title: "Maracaibo", address: "Zulia", lat: 10.634513985864011, lng: -71.65448095792671 },
    { title: "Maracay", address: "Aragua", lat: 10.244369482589198, lng: -67.59380676956442 },
    // Batch 11
    { title: "Barcelona", address: "Anzoátegui", lat: 10.135021127575763, lng: -64.68626787096842 },
    { title: "Boca de Uchire", address: "Anzoátegui", lat: 10.13212992449421, lng: -65.41980783422997 },
    { title: "Carupano", address: "Sucre", lat: 10.64230944656117, lng: -63.25598162257759 },
    { title: "Clarines", address: "Anzoátegui", lat: 9.940335278168114, lng: -65.16431145914734 },
    { title: "Puerto Cabello", address: "Carabobo", lat: 10.468607286715846, lng: -68.02923358846535 },
    // Batch 12
    { title: "Punto Fijo", address: "Falcón", lat: 11.709736042418722, lng: -70.18137200155114 },
    { title: "San Carlos", address: "Cojedes", lat: 9.663955756396168, lng: -68.58442151119475 },
    { title: "San Juan de los Morros", address: "Guárico", lat: 9.912458996428985, lng: -67.3548496281819 },
    { title: "Tucacas", address: "Falcón", lat: 10.790273377587667, lng: -68.32335863548283 },
    { title: "Valencia", address: "Carabobo", lat: 10.16957249316951, lng: -68.00178331020784 },
    { title: "San Felipe", address: "Yaracuy", lat: 10.34005765570472, lng: -68.7431089930932 },
    { title: "Bocono", address: "Trujillo", lat: 9.25406240131883, lng: -70.2490338681755 },
    { title: "Merida", address: "Merida", lat: 8.570577700596587, lng: -71.18115119045595 },
    { title: "San Cristobal", address: "Táchira", lat: 7.7623922023133085, lng: -72.22155252648194 },
    { title: "Valera", address: "Trujillo", lat: 9.314987620561668, lng: -70.60765180995233 },
    { title: "Ciudad Bolivar", address: "Bolívar", lat: 8.095054114468255, lng: -63.5519180353494 },
    { title: "El Cayao", address: "Bolívar", lat: 8.085614410048219, lng: -63.5545682787963 },
    { title: "Zoom de Higuerote", address: "Higuerote, Miranda", lat: 10.481403499892968, lng: -66.09885822605273 },
];

// 1. Maps Grounding Service
export const searchPlaces = async (query, userLocation) => {
    console.log("🔍 Searching places for:", query);
    // Helper to filter mock suggestions
    const getFilteredSuggestions = () => {
        if (!query) return [];
        const lowerQ = query.toLowerCase();
        return MOCK_LOCATIONS.filter(place =>
            place.title.toLowerCase().includes(lowerQ) ||
            place.address.toLowerCase().includes(lowerQ)
        );
    };

    // 1. Get Local Suggestions
    const localSuggestions = getFilteredSuggestions();

    // 2. Get AI/Google Maps Suggestions (Attempt Gemini first, then Places API fallback)
    let aiSuggestions = [];

    // METHOD A: Google Places Autocomplete Service (Standard, Reliable)
    if (window.google && window.google.maps && window.google.maps.places) {
        try {
            console.log("🗺️ Using standard Google Places Autocomplete Service...");
            const service = new window.google.maps.places.AutocompleteService();

            // Create a promise to handle the callback-based API
            const placesPromise = new Promise((resolve) => {
                service.getPlacePredictions({
                    input: query,
                    componentRestrictions: { country: 've' }, // Restrict to Venezuela
                    // optional: location: userLocation ? new window.google.maps.LatLng(userLocation.lat, userLocation.lng) : null,
                    // optional: radius: 50000 
                }, (predictions, status) => {
                    if (status === window.google.maps.places.PlacesServiceStatus.OK && predictions) {
                        resolve(predictions.map(p => ({
                            title: p.structured_formatting.main_text,
                            address: p.structured_formatting.secondary_text,
                            place_id: p.place_id,
                            isGoogleMaps: true
                        })));
                    } else {
                        resolve([]);
                    }
                });
            });

            const placesResults = await placesPromise;
            if (placesResults.length > 0) {
                console.log(`🗺️ Found ${placesResults.length} standard Places results.`);
                aiSuggestions = [...aiSuggestions, ...placesResults];
            }
        } catch (e) {
            console.error("Standard Places API error:", e);
        }
    }

    // METHOD B: Gemini Grounding (Enrichment / Semantic Search) - Only if standard failed or for variety
    if (aiSuggestions.length === 0) {
        try {
            console.log("🤖 Asking Gemini for Google Maps results (Backup)...");
            const response = await ai.models.generateContent({
                model: "gemini-2.0-flash-exp",
                // Broader prompt: Venezuela > Higuerote priority
                contents: `Find places matching "${query}" in Venezuela, prioritizing Higuerote and Miranda state. Return the result as a list of places.`,
                config: {
                    tools: [{ googleMaps: {} }],
                    toolConfig: userLocation ? {
                        retrievalConfig: {
                            latLng: {
                                latitude: userLocation.lat,
                                longitude: userLocation.lng
                            }
                        }
                    } : undefined,
                },
            });

            const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
            if (chunks) {
                chunks.forEach((chunk) => {
                    if (chunk.web?.uri && chunk.web?.title) {
                        const baseLat = userLocation?.lat || 10.486;
                        const baseLng = userLocation?.lng || -66.094;
                        const randomOffset = () => (Math.random() - 0.5) * 0.05;

                        aiSuggestions.push({
                            title: chunk.web.title,
                            address: "Google Maps Result",
                            uri: chunk.web.uri,
                            lat: baseLat + randomOffset(),
                            lng: baseLng + randomOffset(),
                            isGoogleMaps: true
                        });
                    }
                });
            }
        } catch (error) {
            console.error("Maps search error:", error);
        }
    }

    // 3. Merge Results
    const combined = [...localSuggestions, ...aiSuggestions];
    console.log(`✅ Search complete. Local: ${localSuggestions.length}, External: ${aiSuggestions.length}`);

    return combined;
};

// 2. Chat Service
export const chatWithAI = async (message, history) => {
    try {
        const chat = ai.chats.create({
            model: 'gemini-2.0-flash', // Using 2.0 flash which is widely available
            history: history,
            config: {
                systemInstruction: "You are a helpful assistant for HIGO, a ride-sharing app in Higuerote, Venezuela. Keep answers concise and helpful.",
            },
        });

        const result = await chat.sendMessage({ message });
        return result.text;
    } catch (error) {
        console.error("Chat error:", error);
        return "I'm having trouble connecting right now. Please try again later. (Check API Key)";
    }
};

// 3. Text-to-Speech Service
export const generateSpeech = async (text) => {
    try {
        // This is a hypothetical model/endpoint from the snippet.
        const response = await ai.models.generateContent({
            model: "gemini-2.0-flash-exp",
            contents: [{ parts: [{ text }] }],
            config: {
                responseModalities: ["AUDIO"],
                speechConfig: {
                    voiceConfig: {
                        prebuiltVoiceConfig: { voiceName: 'Kore' },
                    },
                },
            },
        });

        const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (!base64Audio) return null;

        const binaryString = atob(base64Audio);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }

        const audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
        const audioBuffer = await audioContext.decodeAudioData(bytes.buffer);
        return audioBuffer;

    } catch (error) {
        console.error("TTS error:", error);
        return null;
    }
};

export const playAudioBuffer = (buffer) => {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContext.destination);
    source.start(0);
};
