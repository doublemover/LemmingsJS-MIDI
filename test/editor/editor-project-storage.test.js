import { expect } from 'chai';
import {
  EDITOR_PROJECT_BUNDLE_KIND,
  PROJECT_STORAGE_KEYS,
  createEditorProject,
  createEditorProjectLevel,
  createEditorProjectPackBundle,
  deleteEditorProject,
  deleteEditorProjectLevel,
  duplicateEditorProjectLevel,
  listSavedProjects,
  loadEditorProject,
  renameEditorProjectLevel,
  saveEditorProject,
  upsertEditorProjectLevel,
  __test__
} from '../../js/editor/EditorProjectStorage.js';

class MemoryStorage {
  constructor() {
    this.data = new Map();
  }

  getItem(key) {
    return this.data.has(key) ? this.data.get(key) : null;
  }

  setItem(key, value) {
    this.data.set(key, value);
  }

  removeItem(key) {
    this.data.delete(key);
  }
}

describe('EditorProjectStorage', () => {
  it('creates projects from current level text and derives metadata', () => {
    const project = createEditorProject({
      id: 'project-a',
      name: 'Pack A',
      text: 'TITLE First Level\nSTYLE dirt\n',
      updatedAt: 10
    });

    expect(project).to.include({
      id: 'project-a',
      name: 'Pack A',
      version: 1,
      updatedAt: 10
    });
    expect(project.levels).to.have.lengthOf(1);
    expect(project.levels[0]).to.include({
      title: 'First Level',
      style: 'dirt',
      updatedAt: 10
    });
    expect(project.activeLevelId).to.equal(project.levels[0].id);
  });

  it('creates standalone project levels with deterministic ids', () => {
    const level = createEditorProjectLevel({
      title: 'Standalone',
      text: 'TITLE Standalone\n',
      now: () => 123,
      updatedAt: 123
    });

    expect(level.id).to.match(/^level-123-\d+$/);
    expect(level.title).to.equal('Standalone');
  });

  it('saves, lists, loads, and deletes projects', () => {
    const storage = new MemoryStorage();
    const first = createEditorProject({
      id: 'first',
      name: 'First',
      text: 'TITLE First\n',
      updatedAt: 1
    });
    const second = createEditorProject({
      id: 'second',
      name: 'Second',
      text: 'TITLE Second\n',
      updatedAt: 5
    });

    expect(saveEditorProject(storage, first)).to.equal('first');
    expect(saveEditorProject(storage, second)).to.equal('second');

    const list = listSavedProjects(storage);
    expect(list.map(entry => entry.id)).to.deep.equal(['second', 'first']);
    expect(list[0].levelCount).to.equal(1);

    const loaded = loadEditorProject(storage, 'first');
    expect(loaded.name).to.equal('First');
    expect(loaded.levels[0].title).to.equal('First');

    expect(deleteEditorProject(storage, 'first')).to.equal(true);
    expect(loadEditorProject(storage, 'first')).to.equal(null);
    expect(listSavedProjects(storage).map(entry => entry.id)).to.deep.equal(['second']);
  });

  it('migrates legacy project index arrays', () => {
    const storage = new MemoryStorage();
    storage.setItem(PROJECT_STORAGE_KEYS.index, JSON.stringify([
      { id: 'a', name: 'Alpha', updatedAt: 2 },
      { id: 'b', name: 'Beta', updatedAt: 3 }
    ]));

    const list = listSavedProjects(storage);
    expect(list.map(entry => entry.id)).to.deep.equal(['b', 'a']);
    expect(JSON.parse(storage.getItem(PROJECT_STORAGE_KEYS.index)).version).to.equal(1);
  });

  it('handles invalid storage data and write failures without throwing', () => {
    const storage = {
      getItem() {
        throw new Error('read failed');
      },
      setItem() {
        throw new Error('write failed');
      },
      removeItem() {
        throw new Error('remove failed');
      }
    };

    expect(listSavedProjects(storage)).to.deep.equal([]);
    expect(loadEditorProject(storage, 'missing')).to.equal(null);
    expect(saveEditorProject(storage, createEditorProject({ id: 'safe' }))).to.equal('safe');
    expect(deleteEditorProject(storage, 'safe')).to.equal(true);
  });

  it('upserts, duplicates, renames, and deletes project levels', () => {
    let project = createEditorProject({
      id: 'project-a',
      name: 'Pack A',
      levels: [{
        id: 'one',
        title: 'One',
        style: 'dirt',
        text: 'TITLE One\nSTYLE dirt\n',
        updatedAt: 1
      }],
      activeLevelId: 'one',
      updatedAt: 1
    });

    project = upsertEditorProjectLevel(project, {
      id: 'two',
      title: 'Two',
      style: 'marble',
      text: 'TITLE Two\nSTYLE marble\n',
      updatedAt: 2
    });
    expect(project.levels.map(level => level.id)).to.deep.equal(['one', 'two']);
    expect(project.activeLevelId).to.equal('two');

    project = upsertEditorProjectLevel(project, {
      title: 'Three',
      style: 'dirt',
      text: 'TITLE Three\nSTYLE dirt\n',
      updatedAt: 2,
      now: () => 200
    });
    expect(project.levels.map(level => level.title)).to.deep.equal(['One', 'Two', 'Three']);
    expect(project.activeLevelId).to.match(/^level-200-\d+$/);

    project = duplicateEditorProjectLevel(project, 'two', {
      id: 'two-copy',
      updatedAt: 3
    });
    expect(project.levels.map(level => level.id)).to.deep.equal([
      'one',
      'two',
      'two-copy',
      project.levels[3].id
    ]);
    expect(project.levels[2].title).to.equal('Two Copy');
    expect(project.activeLevelId).to.equal('two-copy');

    project = renameEditorProjectLevel(project, 'two-copy', 'Finale', 4);
    expect(project.levels[2].title).to.equal('Finale');
    expect(project.updatedAt).to.equal(4);

    project = deleteEditorProjectLevel(project, 'two-copy', 5);
    expect(project.levels.map(level => level.id)).to.deep.equal(['one', 'two', project.levels[2].id]);
    expect(project.activeLevelId).to.equal(project.levels[2].id);
  });

  it('creates pack bundles with nxmi files and validation summaries', () => {
    const project = createEditorProject({
      id: 'project-a',
      name: 'Pack A',
      levels: [
        { id: 'one', title: 'First Level', style: 'dirt', text: 'TITLE First Level\n', updatedAt: 1 },
        { id: 'two', title: 'Second Level', style: 'marble', text: 'TITLE Second Level\n', updatedAt: 2 }
      ],
      activeLevelId: 'one',
      updatedAt: 2
    });

    const bundle = createEditorProjectPackBundle(project, {
      exportedAt: 99,
      packValidationReport: { summary: { errors: 0, warnings: 2 } },
      reportsByLevelId: {
        one: { summary: { errors: 0, warnings: 1 } }
      }
    });

    expect(bundle.kind).to.equal(EDITOR_PROJECT_BUNDLE_KIND);
    expect(bundle.exportedAt).to.equal(99);
    expect(bundle.files.map(file => file.path)).to.deep.equal([
      'info.nxmi',
      'levels.nxmi',
      'levels/first-level-one.nxlv',
      'levels/second-level-two.nxlv'
    ]);
    expect(bundle.packValidationReport.summary).to.deep.equal({ errors: 0, warnings: 2 });
    expect(bundle.project.levels[0].validation).to.deep.equal({ errors: 0, warnings: 1 });
    expect(bundle.validationReports[1].report).to.equal(null);
  });

  it('exposes deterministic helpers for metadata and sorting', () => {
    expect(__test__.getTextHeader('TITLE My Level\nSTYLE dirt\n', 'title')).to.equal('My Level');
    expect(__test__.sanitizeFileSegment('My Level!!')).to.equal('my-level');
    expect(__test__.compareSavedProjects({ name: 'A', updatedAt: 1 }, { name: 'B', updatedAt: 2 }))
      .to.equal(1);
  });
});
