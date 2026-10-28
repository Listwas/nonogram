"""Independent exact row-search audit. Does not import the application's solver."""
import json, sys
from functools import lru_cache
@lru_cache(None)
def arrangements(n, clue):
    if not clue:
        return ((0,)*n,)
    out=[]
    def place(k,start,line):
        needed=sum(clue[k:])+len(clue)-k-1
        for pos in range(start,n-needed+1):
            next_line=line[:]
            next_line[pos:pos+clue[k]]=[1]*clue[k]
            if k+1==len(clue):out.append(tuple(next_line))
            else:place(k+1,pos+clue[k]+1,next_line)
    place(0,0,[0]*n)
    return tuple(out)
def prove(p):
    n=p['size'];rows=[arrangements(n,tuple(c)) for c in p['rows']];cols=[arrangements(n,tuple(c)) for c in p['cols']]
    solutions=[]
    def search(r,available,board):
        if len(solutions)>=2:return
        if r==n:
            solutions.append(board);return
        for row in rows[r]:
            next_columns=[tuple(c for c in available[j] if c[r]==value) for j,value in enumerate(row)]
            if all(next_columns):search(r+1,next_columns,board+list(row))
            if len(solutions)>=2:return
    search(0,cols,[])
    assert len(solutions)==1 and solutions[0]==p['answer'],p['id']
boards=json.load(open(sys.argv[1]))
for p in boards:prove(p)
print(f'Independent Python solver confirmed {len(boards)} unique solutions and matching answers.')
