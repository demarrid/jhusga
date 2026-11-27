cd /tmp
for f in af5b2495 7b44d39d ea11d9ad; do fold -s -w 120 con-$f.txt > con-$f.fold; done
echo "== April vs Sept"; diff con-af5b2495.fold con-7b44d39d.fold | head -40
echo "== Sept vs Sept18"; diff con-7b44d39d.fold con-ea11d9ad.fold | head -120
echo "== April vs Sept18"; diff con-af5b2495.fold con-ea11d9ad.fold | wc -l
