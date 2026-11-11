#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Micro-tests du gate hermes-lite : logique de décision, API simulée."""

import importlib.util
import json
import os
import sys

spec = importlib.util.spec_from_file_location(
    'gate', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'gate.py'))
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)

# Les tests ne doivent pas dormir pour de vrai (settle pollue avec pauses).
gate.time.sleep = lambda s: None


class FakeApi:
    """Remplace gate.api : enregistre les appels, renvoie des réponses scriptées."""

    def __init__(self):
        self.calls = []
        self.compare_behind = 0
        self.compare_behind_seq = []  # si renseigné : une valeur par appel compare
        self.pull = None              # réponse GET /pulls/N (settle après refresh)
        self.mergeable = True
        self.mergeable_state = 'clean'
        self.statuses = {}
        self.update_branch_code = 202
        self.merge_code = 200

    def __call__(self, method, url, body=None, token=None):
        self.calls.append((method, url))
        if method == 'GET' and '/compare/' in url:
            if self.compare_behind_seq:
                self.compare_behind = self.compare_behind_seq.pop(0)
            return 200, {'behind_by': self.compare_behind}
        if (method == 'GET' and isinstance(self.pull, dict)
                and url.endswith('/pulls/%d' % self.pull.get('number', 0))):
            return 200, self.pull
        if method == 'GET' and url.endswith('/status'):
            return 200, {'statuses': [
                {'context': c, 'state': s} for c, s in self.statuses.items()]}
        if method == 'PUT' and url.endswith('/update-branch'):
            return self.update_branch_code, {}
        if method == 'PUT' and url.endswith('/merge'):
            return self.merge_code, {}
        if method == 'POST' and '/check-runs' in url:
            return 201, {}
        if method in ('POST', 'DELETE') and '/labels' in url:
            return 200, {}
        return 200, {}

    def called(self, method, frag):
        return any(m == method and frag in u for m, u in self.calls)


def pr(number=1, **kw):
    d = {'number': number, 'state': 'open', 'draft': False,
         'labels': [],
         'head': {'sha': 'abc'}, 'base': {'ref': 'main'}}
    d.update(kw)
    return d


def run(fx, p, required=()):
    gate.api = fx
    return gate.handle_pr(p, 'o/r', 'tok', list(required), dry=False)


FAILURES = []


def check(name, cond):
    print(('PASS ' if cond else 'FAIL ') + name)
    if not cond:
        FAILURES.append(name)


# 1. Retard sans conflit -> rebase serveur, puis settle : merge dans le même run
fx = FakeApi()
fx.compare_behind_seq = [3, 0]           # 1er compare : derrière ; settle : à jour
fx.pull = pr(1)                          # relecture settle
r = run(fx, pr(1))
check('retard sans conflit : update-branch appelé', fx.called('PUT', '/update-branch'))
check('retard sans conflit : settle a mergé dans le même run', fx.called('PUT', '/merge'))
check('retard sans conflit : verdict merged', r == 'merged')

# 1b. Settle révèle un conflit -> escalade, pas de merge
fx = FakeApi()
fx.compare_behind_seq = [3, 0]
fx.pull = pr(11, mergeable=False, mergeable_state='dirty')
r = run(fx, pr(11))
check('settle conflit : pas de merge', not fx.called('PUT', '/merge'))
check('settle conflit : verdict conflict', r == 'conflict')

# 1c. Settle timeout (rebase jamais appliqué) -> timeout, pas de merge
fx = FakeApi()
fx.compare_behind_seq = [3]              # sticky : toujours derrière
fx.pull = pr(12)
r = run(fx, pr(12))
check('settle timeout : pas de merge', not fx.called('PUT', '/merge'))
check('settle timeout : verdict timeout', r == 'timeout')

# 2. Frais + checks verts -> merge
fx = FakeApi()
r = run(fx, pr(2), required=('ci',))
fx.statuses = {'ci': 'success'}
# (statuses lus pendant handle_pr via try_merge -> re-set ici est trop tard ;
#  on refait proprement)
fx2 = FakeApi()
fx2.statuses = {'ci': 'success'}
r2 = run(fx2, pr(2), required=('ci',))
check('frais + vert : merge appelé', fx2.called('PUT', '/merge'))
check('frais + vert : verdict merged', r2 == 'merged')

# 3. Frais mais check requis absent -> attente, pas de merge
fx = FakeApi()
fx.statuses = {'ci': 'pending'}
r = run(fx, pr(3), required=('ci',))
check('check requis non vert : pas de merge', not fx.called('PUT', '/merge'))
check('check requis non vert : verdict waiting', r == 'waiting')

# 4. Vrai conflit -> check rouge + label, pas de refresh ni merge
fx = FakeApi()
r = run(fx, pr(4, mergeable=False, mergeable_state='dirty'))
check('conflit : pas de rebase serveur', not fx.called('PUT', '/update-branch'))
check('conflit : pas de merge', not fx.called('PUT', '/merge'))
check('conflit : check rouge posé', fx.called('POST', '/check-runs'))
check('conflit : label hermes/conflit posé', fx.called('POST', '/issues/4/labels'))
check('conflit : verdict conflict', r == 'conflict')

# 5. Rebase serveur refusé (422) -> traité comme un vrai conflit
fx = FakeApi()
fx.compare_behind = 2
fx.update_branch_code = 422
r = run(fx, pr(5))
check('refresh refusé : update-branch tenté', fx.called('PUT', '/update-branch'))
check('refresh refusé : pas de check rouge', not fx.called('POST', '/check-runs'))
check('refresh refusé : pas de label conflit', not fx.called('POST', '/issues/5/labels'))
check('refresh refusé : verdict behind', r == 'behind')

# 5b. mergeable inconnu dans la liste -> le gate relit la PR et voit le conflit
fx = FakeApi()
fx.compare_behind = 1
fx.pull = pr(7, mergeable=False, mergeable_state='dirty')
r = run(fx, pr(7))
check('relecture : GET /pulls/7 appelé', fx.called('GET', '/pulls/7'))
check('relecture : conflit détecté', r == 'conflict')
check('relecture : label conflit posé', fx.called('POST', '/issues/7/labels'))

# 6. Rebase refusé ET PR réellement en conflit -> conflit, escalade
fx = FakeApi()
fx.compare_behind = 2
fx.update_branch_code = 422
r = run(fx, pr(6, mergeable=False, mergeable_state='dirty'))
check('conflit réel : check rouge posé', fx.called('POST', '/check-runs'))
check('conflit réel : label conflit posé', fx.called('POST', '/issues/6/labels'))
check('conflit réel : verdict conflict', r == 'conflict')

print()
if FAILURES:
    print('ÉCHECS : %d -> %s' % (len(FAILURES), ', '.join(FAILURES)))
    sys.exit(1)
print('Tous les tests passent.')

