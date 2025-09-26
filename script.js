import * as THREE from 'three';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

let camera, scene, renderer;
let ramObjects = [];
let trayObjects = [];
let currentCube = null;

init();

function init() {
    camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 20);
    camera.position.set(1, 1, 1);
    camera.lookAt(0, 0, 0);

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xaaaaaa);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth - 250, window.innerHeight); // 250px für UI
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.outputEncoding = THREE.sRGBEncoding;
    document.getElementById('scene-container').appendChild(renderer.domElement);

    window.addEventListener('resize', () => {
        camera.aspect = (window.innerWidth - 250) / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth - 250, window.innerHeight);
    });

    // Boden
    const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(5, 5),
        new THREE.MeshStandardMaterial({
            color: 0x777777,
            roughness: 0.8,
            metalness: 0,
            emissive: new THREE.Color(0x777777),
            emissiveIntensity: 0.8
        })
    );
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);

    const onProgress = xhr => {};

    new MTLLoader()
        .setPath('models/obj/server/')
        .load('server.mtl', function (materials) {
            materials.preload();
            adjustMaterials(materials);

            new OBJLoader()
                .setMaterials(materials)
                .setPath('models/obj/server/')
                .load('server.obj', function (object) {
                    object.scale.setScalar(0.012);
                    object.traverse(child => {
                        if (child.isMesh) {
                            if (child.name.startsWith('RAM.')) {
                                ramObjects[parseInt(child.name.split('.')[1])] = child;
                                child.visible = false;
                            }
                            if (child.name.startsWith('Tray.')) {
                                trayObjects[parseInt(child.name.split('.')[1])] = child;
                                child.visible = false;
                            }
                            if (child.material) {
                                makeEmissive(child.material);
                            }
                        }
                    });
                    scene.add(object);
                }, onProgress);
        });

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.minDistance = 0.4;
    controls.maxDistance = 1;
    controls.enablePan = false;
    controls.minPolarAngle = Math.PI / 4;
    controls.maxPolarAngle = Math.PI / 2.5;
    controls.update();
    controls.saveState();

    populateDropdown('ramCount', 24, 2);
    populateDropdown('trayCount', 10, 1);
    populateDropdown('cubeSelect', 2, 1, true);

    document.getElementById('ramCount').addEventListener('change', e => updateVisibility(ramObjects, parseInt(e.target.value)));
    document.getElementById('trayCount').addEventListener('change', e => updateVisibility(trayObjects, parseInt(e.target.value)));
    document.getElementById('cubeSelect').addEventListener('change', loadCube);

    window.addEventListener('resize', onWindowResize);
    renderer.setAnimationLoop(animate);
}

function populateDropdown(id, max, step, skipZeroOption = false) {
    const select = document.getElementById(id);
    for (let i = skipZeroOption ? 0 : 1; i <= max; i += step) {
        const opt = document.createElement('option');
        opt.value = i;
        opt.textContent = i;
        select.appendChild(opt);
    }
}

function updateVisibility(objects, count) {
    objects.forEach((obj, i) => { if (obj) obj.visible = i < count; });
}

function adjustMaterials(materials) {
    for (const mat of Object.values(materials.materials)) {
        makeEmissive(mat);
    }
}

function makeEmissive(material) {
    if (Array.isArray(material)) {
        material.forEach(m => {
            m.emissive = m.color.clone();
            m.emissiveIntensity = 0.8;
        });
    } else {
        material.emissive = material.color.clone();
        material.emissiveIntensity = 0.8;
    }
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
    renderer.render(scene, camera);
}

function loadCube(e) {
    const cubeIndex = e.target.value;
    if (!cubeIndex) return;

    if (currentCube) {
        scene.remove(currentCube);
        currentCube.traverse(child => {
            if (child.isMesh) {
                child.geometry.dispose();
                if (child.material) {
                    if (Array.isArray(child.material)) {
                        child.material.forEach(mat => mat.dispose());
                    } else {
                        child.material.dispose();
                    }
                }
            }
        });
        currentCube = null;
    }

    const path = `models/obj/test_cubes/`;
    const objFile = `${cubeIndex}.obj`;
    const mtlFile = `${cubeIndex}.mtl`;

    new MTLLoader()
        .setPath(path)
        .load(mtlFile, materials => {
            materials.preload();
            adjustMaterials(materials);
            new OBJLoader()
                .setMaterials(materials)
                .setPath(path)
                .load(objFile, obj => {
                    obj.scale.setScalar(0.5);
                    obj.traverse(child => {
                        if (child.isMesh) {
                            if (child.material) {
                                makeEmissive(child.material);
                            }
                        }
                    });
                    currentCube = obj;
                    scene.add(obj);
                });
        });
}