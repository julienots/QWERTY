import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
for (const f of process.argv.slice(2)) {
  const doc = await io.read(f);
  const root = doc.getRoot();
  console.log('==', f);
  console.log('anims:', root.listAnimations().map((a) => a.getName() + '(' + a.listChannels().length + ')').join(', '));
  console.log('materials:', root.listMaterials().map((m) => m.getName() + (m.getBaseColorTexture() ? '[tex]' : '') + JSON.stringify(m.getBaseColorFactor().map(x=>+x.toFixed(2)))).join(', '));
  console.log('meshes:', root.listMeshes().map((m) => m.getName()).join(', '));
  const nodes = root.listNodes().map((n) => n.getName());
  console.log('nodes', nodes.length, nodes.slice(0, 70).join(' '));
  const skin = root.listSkins()[0];
  if (skin) console.log('scale of root nodes:', root.listScenes()[0].listChildren().map((n)=>n.getName()+':'+n.getScale().map(v=>+v.toFixed(3))+' r'+n.getRotation().map(v=>+v.toFixed(3))).join(' | '));
}
