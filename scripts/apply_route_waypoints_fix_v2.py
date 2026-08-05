from pathlib import Path
import runpy

path = Path('scripts/apply_route_waypoints_fix.py')
source = path.read_text(encoding='utf-8')

first_block = '''replace_once(
    'src/services/directionsService.js',
    "        return haversineFallback(origin, destination);",
    "        return haversineFallback(origin, destination, waypoints);",
)
'''
final_block = '''replace_once(
    'src/services/directionsService.js',
    "        return haversineFallback(origin, destination);\\n    }\\n};",
    "        return haversineFallback(origin, destination, waypoints);\\n    }\\n};",
)
'''

if source.count(first_block) != 1 or source.count(final_block) != 1:
    raise SystemExit('unable to normalize directions fallback replacements')
source = source.replace(first_block, '', 1).replace(final_block, '', 1)
path.write_text(source, encoding='utf-8')

service = Path('src/services/directionsService.js')
text = service.read_text(encoding='utf-8')
old = '        return haversineFallback(origin, destination);'
if text.count(old) != 2:
    raise SystemExit(f'expected two fallback calls, found {text.count(old)}')
service.write_text(text.replace(old, '        return haversineFallback(origin, destination, waypoints);'), encoding='utf-8')

runpy.run_path(str(path), run_name='__main__')
