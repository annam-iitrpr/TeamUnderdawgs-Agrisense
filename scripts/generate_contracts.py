#!/usr/bin/env python3
"""Generate schemas and language bindings; --check detects any stale artifact."""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path
from typing import get_args

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from pydantic import TypeAdapter

from contracts import models as m
from contracts.routes import ROUTES


def schema_of(model, components):
    schema = TypeAdapter(model).json_schema(ref_template='#/components/schemas/{model}')
    components.update(schema.pop('$defs', {}))
    if hasattr(model, '__name__') and not get_args(model):
        components[model.__name__] = schema
        return {'$ref': f'#/components/schemas/{model.__name__}'}
    return schema


def ts(schema):
    if '$ref' in schema:
        return json.dumps(schema['$ref'].split('/')[-1]).join(['components["schemas"][', ']'])
    if 'const' in schema:
        return json.dumps(schema['const'])
    if 'enum' in schema:
        return ' | '.join(json.dumps(x) for x in schema['enum'])
    for key in ('anyOf', 'oneOf'):
        if key in schema:
            return ' | '.join(f'({ts(x)})' for x in schema[key])
    kind = schema.get('type')
    if kind == 'array':
        if 'prefixItems' in schema:
            return '[' + ', '.join(ts(x) for x in schema['prefixItems']) + ']'
        return f'Array<{ts(schema.get("items", {}))}>'
    if kind == 'object' or 'properties' in schema:
        fields = [f'{json.dumps(k)}{"" if k in schema.get("required", []) else "?"}: {ts(v)};' for k,v in schema.get('properties', {}).items()]
        extra = schema.get('additionalProperties')
        if isinstance(extra, dict):
            fields.append(f'[key: string]: {ts(extra)};')
        return '{ ' + ' '.join(fields) + ' }'
    return {'string':'string','number':'number','integer':'number','boolean':'boolean','null':'null'}.get(kind, 'unknown')


def artifacts():
    components = {}
    for obj in vars(m).values():
        if isinstance(obj, type) and issubclass(obj, m.ContractModel) and obj not in (m.ContractModel, m.Envelope, m.Page):
            schema_of(obj, components)
    paths = {}
    for method, path, request, response, status in ROUTES:
        op = method.lower() + '_' + path.strip('/').replace('/','_').replace('{id}','by_id')
        params = []
        if '{id}' in path:
            params.append({'name':'id','in':'path','required':True,'schema':{'type':'string','minLength':1,'maxLength':128}})
        if method == 'GET' and 'Page[' in str(response):
            params += [{'name':'limit','in':'query','schema':{'type':'integer','minimum':1,'maximum':100,'default':25}}, {'name':'cursor','in':'query','schema':{'type':'string'}}]
        if method == 'POST' or (method == 'DELETE' and path == '/me'):
            params.append({'name':'Idempotency-Key','in':'header','required':True,'schema':{'type':'string','minLength':8,'maxLength':128}})
        if method == 'DELETE' and path == '/reminders/{id}':
            params.append({'name':'expected_version','in':'query','required':True,'schema':{'type':'integer','minimum':1}})
        if path == '/catalog/locations':
            params.append({'name':'q','in':'query','required':True,'schema':{'type':'string','minLength':2,'maxLength':100}})
        if path in ('/tasks','/notifications','/reminders'):
            params.append({'name':'season_id','in':'query','schema':{'type':'string'}})
        responses = {str(status):{'description':'Successful result','content':{'application/json':{'schema':schema_of(m.Envelope[response],components)}}}}
        if path == '/seasons/{id}/evaluate':
            responses['202'] = {'description':'Durably queued evaluation','content':{'application/json':{'schema':schema_of(m.Envelope[m.Job], components)}}}
        for code in (401,403,404,409,422,429,503):
            responses[str(code)] = {'description':str(code),'content':{'application/json':{'schema':{'$ref':'#/components/schemas/ErrorResponse'}}}}
        operation = {'operationId':op,'tags':[path.strip('/').split('/')[0]],'security':[{'firebaseBearer':[]}],'parameters':params,'responses':responses}
        if request:
            operation['requestBody'] = {'required':True,'content':{'application/json':{'schema':schema_of(request,components)}}}
        paths.setdefault('/api/v1'+path,{})[method.lower()] = operation
    doc = {'openapi':'3.1.0','info':{'title':'AgriSense contract_v1','version':'1.0.0','description':'IDs are opaque strings. UTC timestamps, Asia/Kolkata calendar dates. All private routes require verified Firebase identity. Unknown values remain null with reasons. Contract publication is not proof of endpoint implementation.'},'paths':paths,'components':{'securitySchemes':{'firebaseBearer':{'type':'http','scheme':'bearer','bearerFormat':'Firebase ID token'}},'schemas':components}}
    outputs = {'contracts/openapi.yaml': json.dumps(doc,indent=2,sort_keys=True)+'\n'}  # JSON is valid YAML 1.2.
    for filename, model in [('science',m.SeasonSnapshot | m.ReferenceBundle | m.ForecastBundle | m.EvaluationBundle | m.PlanningSnapshot | m.ClimateBundle | m.CropComparison | m.ClosureSnapshot | m.SeasonEvaluation),('events',m.DomainEvent)]:
        schema = TypeAdapter(model).json_schema()
        schema.update({'$schema':'https://json-schema.org/draft/2020-12/schema','$id':f'https://agrisense.example/contracts/v1/{filename}.schema.json'})
        outputs[f'contracts/{filename}.schema.json'] = json.dumps(schema,indent=2,sort_keys=True)+'\n'
    header = '// Generated by scripts/generate_contracts.py; do not edit.\n'
    lines = [header, 'export interface components { schemas: {']
    lines += [f'  {json.dumps(name)}: {ts(schema)};' for name,schema in sorted(components.items())]
    lines += ['} }', 'export interface paths {']
    for path, operations in sorted(paths.items()):
        lines.append(f'{json.dumps(path)}: {{')
        for method,operation in operations.items():
            body = operation.get('requestBody',{}).get('content',{}).get('application/json',{}).get('schema')
            request = f'requestBody: {ts(body)}; ' if body else ''
            responses = ' '.join(f'{code}: {ts(item["content"]["application/json"]["schema"])};' for code,item in operation['responses'].items())
            lines.append(f'{method}: {{ {request}responses: {{ {responses} }} }};')
        lines.append('};')
    lines += ['}', 'export type Schema<Name extends keyof components["schemas"]> = components["schemas"][Name];']
    outputs['web/lib/generated/api.ts'] = '\n'.join(lines)+'\n'
    outputs['backend/agrisense/contracts_generated/models.py'] = '# Generated by scripts/generate_contracts.py; do not edit.\n'+(ROOT/'contracts/models.py').read_text()
    outputs['backend/agrisense/contracts_generated/__init__.py'] = '"""Generated contract_v1 Pydantic models."""\n'
    # The runtime builds its HTTP surface from the same registry the schema is generated from.
    registry = (ROOT/'contracts/routes.py').read_text().replace('from contracts.models import *', 'from agrisense.contracts_generated.models import *')
    outputs['backend/agrisense/contracts_generated/routes.py'] = '# Generated by scripts/generate_contracts.py; do not edit.\n'+registry
    hashes = {name:hashlib.sha256(value.encode()).hexdigest() for name,value in outputs.items()}
    outputs['contracts/manifest.json'] = json.dumps({'schema_version':'1.0','artifacts':hashes},indent=2,sort_keys=True)+'\n'
    return outputs


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--check',action='store_true')
    args = parser.parse_args()
    stale=[]
    for name,content in artifacts().items():
        path=ROOT/name
        if args.check:
            if not path.exists() or path.read_text()!=content: stale.append(name)
        else:
            path.parent.mkdir(parents=True,exist_ok=True);path.write_text(content)
    if stale:
        print('Stale contracts: '+', '.join(stale));sys.exit(1)
    print('Contract artifacts are consistent.' if args.check else 'Generated contract_v1 schemas and bindings.')
