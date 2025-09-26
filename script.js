import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

let camera, scene, renderer;
let ramObjects = [];
let trayObjects = [];
let currentCube = null;

init();

function init() {
    // Kamera
    camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 20);
    camera.position.set(1.5, 1.2, 1.5);
    camera.lookAt(0, 0, 0);

    // Szene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xaaaaaa); // dunkleres Grau

    // Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth - 250, window.innerHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.getElementById('scene-container').appendChild(renderer.domElement);

    // Fenstergröße anpassen
    window.addEventListener('resize', () => {
        camera.aspect = (window.innerWidth - 250) / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth - 250, window.innerHeight);
    });

    // Drei-Punkt-Beleuchtung (heller)
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.5);
    keyLight.position.set(2, 3, 2);
    keyLight.castShadow = true;
    keyLight.shadow.bias = -0.0005;
    keyLight.shadow.mapSize.width = 2048;
    keyLight.shadow.mapSize.height = 2048;
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xffffff, 1.0);
    fillLight.position.set(-2, 1, 2);
    scene.add(fillLight);

    const backLight = new THREE.DirectionalLight(0xffffff, 0.8);
    backLight.position.set(0, 2, -3);
    scene.add(backLight);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    // Lade GLB-Modell
    const loader = new GLTFLoader();
    loader.load('models/glb/server.glb', gltf => {
        const object = gltf.scene;
        object.scale.setScalar(0.012);

        object.traverse(child => {
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;

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
                    enhanceMaterial(child.material);
                }
            }
        });

        scene.add(object);
    });

    // OrbitControls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.minDistance = 0.4;
    controls.maxDistance = 2.5;
    controls.enablePan = false;
    controls.minPolarAngle = Math.PI / 6;
    controls.maxPolarAngle = Math.PI / 2.3;
    controls.update();
    controls.saveState();

    // Dropdowns vorbereiten
    populateDropdown('ramCount', 24, 2);
    populateDropdown('trayCount', 10, 1);
    populateDropdown('cubeSelect', 2, 1, true);

    document.getElementById('ramCount').addEventListener('change', e => updateVisibility(ramObjects, parseInt(e.target.value)));
    document.getElementById('trayCount').addEventListener('change', e => updateVisibility(trayObjects, parseInt(e.target.value)));
    document.getElementById('cubeSelect').addEventListener('change', loadCube);

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

function makeEmissive(material) {
    if (Array.isArray(material)) {
        material.forEach(m => {
            m.emissive = m.color.clone();
            m.emissiveIntensity = 0.6; // etwas stärker
        });
    } else {
        material.emissive = material.color.clone();
        material.emissiveIntensity = 0.6;
    }
}

function enhanceMaterial(material) {
    if (Array.isArray(material)) {
        material.forEach(m => {
            m.metalness = 0.3;
            m.roughness = 0.5;
        });
    } else {
        material.metalness = 0.3;
        material.roughness = 0.5;
    }
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

    const loaderMTL = new MTLLoader();
    loaderMTL.setPath(path).load(mtlFile, materials => {
        materials.preload();
        for (const mat of Object.values(materials.materials)) {
            makeEmissive(mat);
            enhanceMaterial(mat);
        }

        new OBJLoader()
            .setMaterials(materials)
            .setPath(path)
            .load(objFile, obj => {
                obj.scale.setScalar(0.5);
                obj.traverse(child => {
                    if (child.isMesh) {
                        makeEmissive(child.material);
                        enhanceMaterial(child.material);
                    }
                });
                currentCube = obj;
                scene.add(obj);
            });
    });
}